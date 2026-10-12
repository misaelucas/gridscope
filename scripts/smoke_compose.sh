#!/usr/bin/env bash
# Compose >= 2.24.4 is required for !reset (removing inherited host ports).
set -Eeuo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v docker >/dev/null || { echo 'ERROR: Docker is required.' >&2; exit 2; }
docker compose version >/dev/null || { echo 'ERROR: Docker Compose v2 is required.' >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo 'ERROR: Docker Engine is unavailable; smoke checks did not run.' >&2; exit 2; }

scratch=$(mktemp -d "${TMPDIR:-/tmp}/gridscope-smoke-XXXXXXXXXX")
project=$(basename -- "$scratch" | tr '[:upper:]' '[:lower:]')
compose=(docker compose --project-name "$project" --env-file /dev/null
    -f "$root/compose.yaml" -f "$scratch/override.yaml")
started=0
cleanup() {
    result=$?
    trap - EXIT INT TERM
    if (( started )); then
        if ! "${compose[@]}" down --volumes --remove-orphans --timeout 15; then
            echo "ERROR: Cleanup failed for disposable project $project; inspect it manually." >&2
            result=1
        fi
    fi
    rm -rf -- "$scratch"
    exit "$result"
}
trap cleanup EXIT
trap 'echo "ERROR: Smoke check failed at line $LINENO." >&2' ERR
trap 'exit 130' INT
trap 'exit 143' TERM

# No inherited host ports; all requests run inside this isolated Compose network.
cat > "$scratch/override.yaml" <<'YAML'
services:
  db:
    ports: !reset []
  api:
    ports: !reset []
  dagster:
    ports: !reset []
YAML
"${compose[@]}" config --quiet || {
    echo 'ERROR: Invalid Compose configuration; Compose >= 2.24.4 is required.' >&2
    exit 2
}
echo "Smoke project: $project (disposable volumes; no host ports)"
started=1
"${compose[@]}" build
"${compose[@]}" up -d --wait --wait-timeout 90 db
"${compose[@]}" exec -T db pg_isready -U grid -d grid
"${compose[@]}" up -d api

check_health() {
    "${compose[@]}" exec -T api python - "$1" <<'PY'
import sys
import time
import httpx

ready = sys.argv[1] == "ready"
expected = ({"status": "ok", "database": "ok", "schema": "ready"} if ready else
            {"status": "unavailable", "database": "ok", "schema": "not_ready"})
with httpx.Client(base_url="http://127.0.0.1:8000", timeout=2) as client:
    for attempt in range(60):
        try:
            response = client.get("/health")
            if response.status_code == (200 if ready else 503) and response.json() == expected:
                print("Health verified:", expected)
                break
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1)
    else:
        raise SystemExit("ERROR: API did not reach expected database/schema readiness.")
PY
}
check_health uninitialized
"${compose[@]}" exec -T api grid-report init
check_health ready
"${compose[@]}" up -d dagster
"${compose[@]}" exec -T dagster dagster definitions validate --load-with-grpc -m grid_report.definitions

"${compose[@]}" exec -T api python - <<'PY'
import time
import httpx

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=5) as client:
    def get(path):
        response = client.get(path)
        response.raise_for_status()
        return response

    assert "GridScope" in get("/").text
    report = get("/api/reports?day=2026-10-10").json()
    assert report["day"] == "2026-10-10"
    assert report["timezone"] == "Europe/Copenhagen"
    assert [r["area"] for r in report["regions"]] == ["DK1", "DK2"]
    for region in report["regions"]:
        assert region["expected_intervals"] == region["missing_intervals"] == 288
        assert region["observed_intervals"] == region["completeness_percent"] == 0
        for key in ("average_g_per_kwh", "peak_g_per_kwh", "minimum_g_per_kwh",
                    "latest_observation", "last_ingested_at"):
            assert region[key] is None, key
        series = get(f'/api/series?day=2026-10-10&area={region["area"]}').json()
        assert len(series["observations"]) == 288
        assert all(row["intensity"] is None for row in series["observations"])
    assert get("/api/runs").json() == []
    for asset, content_type in [
        ("fonts.css", "text/css"), ("theme.css", "text/css"),
        ("dashboard.css", "text/css"), ("app.js", "javascript"),
        *[(f"fonts/hanken-grotesk-{weight}.ttf", "font/ttf") for weight in (400, 500, 900)],
    ]:
        response = get(f"/static/{asset}")
        assert response.content, asset
        assert content_type in response.headers["content-type"], asset
    print("Empty reporting, series, runs and packaged assets verified.")

# Verify the running webserver loaded its code location, not just an import in another process.
with httpx.Client(timeout=2) as client:
    for attempt in range(60):
        try:
            response = client.post("http://dagster:3000/graphql", json={
                "query": "{ repositoriesOrError { __typename ... on RepositoryConnection { nodes { name } } } }"})
            response.raise_for_status()
            result = response.json()
            repository = result.get("data", {}).get("repositoriesOrError", {})
            if (not result.get("errors") and repository.get("__typename") == "RepositoryConnection"
                    and repository.get("nodes")):
                print("Dagster webserver code location verified.")
                break
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1)
    else:
        raise SystemExit("ERROR: Dagster webserver did not load its repository.")
PY

echo 'PASS: Compose smoke checks completed; cleaning up disposable resources.'
