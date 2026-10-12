# GridScope — Verification — 2026-10-12

## Dagster smoke initialization fix — 2026-10-12

The reported `secondary_indexes already exists` failure is consistent with concurrent initial
SQLite schema creation: the smoke script started `dagster dev` and immediately invoked
`dagster definitions validate` against the same fresh `/app/.dagster`. Inspection of the installed
CLI confirms it opens a Dagster instance before validation. The traceback identifies that instance's
SQLite table creation, rather than GridScope's PostgreSQL tables or an invalid asset definition.

The smoke test now uses the public `Definitions.validate_loadable(defs)` API without opening
instance storage. The separate GraphQL check still verifies the running Dagster webserver's
code location loads. The deprecated CLI is removed; `dg` / `dagster-dg-cli` is not installed or
declared, so no new CLI dependency or project configuration was introduced.

Actual verification with Docker Engine 29.0.0:

- `.venv/bin/pytest -q tests/test_smoke_definitions.py tests/test_definitions.py`:
  **10 passed in 0.53s**. The actual embedded smoke validator is executed with instance access
  forbidden and an existing DAGSTER_HOME marker; it leaves storage untouched. Invalid resource
  requirements are rejected by the validation API.
- Full suite against a fresh disposable pgserver database: **60 passed, 1 warning in 2.13s**.
  The remaining warning is the existing Starlette/httpx TestClient deprecation.
- `.venv/bin/ruff check .`: All checks passed.
- `bash -n scripts/smoke_compose.sh` and `git diff --check`: passed.
- First real smoke run with the Dagster fix passed definitions validation, then exposed an overly
  strict font MIME assertion. The slim image's MIME lookup returns no type for `.ttf`, so static
  delivery uses the generic binary type. Font checks now compare HTTP bytes to the packaged font
  instead of requiring the host's MIME database; serving behavior and CSS are unchanged.
- `bash scripts/smoke_compose.sh` (log `/tmp/gridscope-smoke-fix-2.log`): **exit 0**. Image builds,
  fresh PostgreSQL readiness, schema-not-ready and ready health responses, empty reports/series,
  packaged assets, definition validation and the running Dagster code location all passed.
  Scoped containers, network and all three volumes were removed successfully.
- Repeated the full smoke test with another fresh project (log
  `/tmp/gridscope-smoke-fix-3.log`): **exit 0** with the same checks passing. Follow-up container
  and volume listings for that exact project were empty after cleanup.

No schedule was enabled, no live ingestion ran, and no existing project volumes were modified.
Validation checks definition structure without creating an instance; the GraphQL check covers
actual code-location loading. This does not verify scheduled execution or production concurrency.
Remote CI has not been run.

## Compose delivery and readiness — 2026-10-12

Executed with Python 3.11.2 and Docker Compose v2.40.3:

- `bash -n scripts/smoke_compose.sh`: passed.
- `docker compose config --quiet`: passed.
- Merged base/temporary smoke override inspected using `docker compose ... config --format json`:
  no published ports, all three volume names prefixed with the disposable project name, and
  build context resolved to this checkout. This configuration check does not require an Engine.
- Embedded smoke-check Python and GitHub Actions YAML parsed successfully.
- A fake Docker executable simulated build failure: exit 17 was preserved, cleanup targeted
  only the generated `gridscope-smoke-*` project, and its temporary override directory was removed.
  This verifies shell failure handling, not real Docker lifecycle behavior.
- `.venv/bin/pytest -q`: 49 passed, 9 database tests skipped, 1 warning in 0.77s.
- Full `.venv/bin/pytest -q`, with `GRID_TEST_DATABASE=1` and `DATABASE_URL` pointing at a new
  temporary pgserver PostgreSQL instance: **58 passed, 1 warning in 1.42s**. The server was stopped
  and its temporary directory removed afterward. Existing demo/development databases were untouched.
- Before initializing that temporary database, `TestClient(app).get('/health')` returned the
  expected 503 JSON with `database: ok` and `schema: not_ready`. Integration tests also verified
  the initialized-schema 200 response. Unit tests cover missing columns and connection failures
  without exposing exception details.
- `.venv/bin/ruff check .`: All checks passed.
- `docker info --format '{{.ServerVersion}}'`: failed because `/var/run/docker.sock` was absent.
- `bash scripts/smoke_compose.sh`: **exit 2**, `Docker Engine is unavailable; smoke checks did not run.`

The remaining warning is the existing Starlette/httpx TestClient deprecation. The Dockerfile,
CI and package metadata now consistently support Python 3.11. The existing PostgreSQL CI job
is preserved; a separate Compose smoke job was added. Remote GitHub Actions has not been run.
Image builds, actual container startup, in-container assets/health checks, Dagster gRPC validation
and its running webserver code location remain **unverified** until the smoke script runs with
a working Engine. No live ingestion or daily schedule activation was performed.

Reproduce the disposable local PostgreSQL run (requires the optional installed `pgserver`):

```bash
.venv/bin/python - <<'PY'
import os
from pathlib import Path
import subprocess
import tempfile
import pgserver

with tempfile.TemporaryDirectory(prefix='gridscope-test-') as directory:
    server = pgserver.get_server(Path(directory) / 'postgres')
    try:
        environment = dict(os.environ, DATABASE_URL=server.get_uri(), GRID_TEST_DATABASE='1')
        subprocess.run(['.venv/bin/pytest', '-q'], env=environment, check=True)
    finally:
        server.cleanup()
PY
```

## Version-control preparation — 2026-10-12

- `.venv/bin/pytest -q tests/test_definitions.py tests/test_domain.py tests/test_source.py`: 20 passed in 0.50s.
- `.venv/bin/ruff check .`: All checks passed.
- This run covered the scheduled-time partition fix and non-database tests. Database integration,
  live ingestion, Docker startup, browser rendering and remote CI were not rerun.
- Public text now uses GridScope. Python distribution/package names, CLI commands and internal
  paths remain unchanged. Existing screenshots predate the identity change.

## Earlier implementation verification

Executed locally with Python 3.11, PostgreSQL bundled by pgserver 0.1.4, and Chromium through Playwright.

- `ruff check .`: passed.
- `python -m compileall -q src scripts`: passed.
- 20 tests passed with real isolated PostgreSQL. One third-party Starlette/httpx deprecation warning remains; no test failures.
- Dagster definitions loaded successfully.
- Real `daily_carbon_report` partition 2026-10-10 materialized successfully and its completeness check passed.
- Integration test verified a partial day can succeed ingestion while failing its completeness check.
- Live Energinet backfill: Danish local dates 2026-09-12 through 2026-10-11 inclusive, 30 days, 17,280 stored observations.
- Reimported 2026-10-11: stored observation count remained 17,280.
- 2026-10-11: both regions had 288/288 observations. DK1 available-reading mean 165.7639 g CO₂/kWh; DK2 70.4861 g CO₂/kWh.
- Browser: two chart paths, no JavaScript errors, missing day renders “No data” rather than zero. Desktop and 390-pixel mobile screenshots inspected. No horizontal page overflow after mobile fix.
- `docker compose config --quiet`: passed. Container build/start was not verified because the Docker daemon was inactive. Local verification used actual PostgreSQL, not SQLite.
- GitHub Actions workflow is prepared; no remote repository was created and CI has not run remotely.

The running preview uses `scripts/serve_local.py`, port 8017, and ignored `data/postgres`. Restart with the README's Docker-free instructions. Raw source responses are preserved under ignored `data/raw`. The schedule is defined but not running/enabled in this preview.

## CSS revision — 2026-10-12

Replaced the original dashboard CSS with a bottenmisa-based structure: local Hanken Grotesk fonts, shared theme-token names/values, thin dividers, restrained layout and subtle background grid. Removed inline styles; SVG uses CSS tokens. Rechecked live rendering on desktop and 390px mobile: no JavaScript errors, two chart series, no page overflow and empty-state behavior preserved. Screenshots updated. Ruff passed. Backend was unchanged.
