# GridScope — Danish Electricity Carbon Intensity Analytics

A Python + PostgreSQL reporting pipeline for Danish electricity consumption carbon intensity. Uses public Energinet CO2Emis observations for DK1 and DK2; provides daily SQL summaries, missing-data checks, a read-only FastAPI service, a React dashboard and Dagster orchestration.

This is a portfolio and learning project, not an operational grid-control tool. Data are preliminary estimates in **g CO₂/kWh**, not total CO₂ emissions. An arithmetic mean of five-minute intensity readings is not a consumption-weighted daily emission factor.

## Start here

Read [the code walkthrough](docs/LEARNING.md), then [the data contract](docs/DATA.md). Inline comments explain the decisions that prevent misleading reports.

```mermaid
flowchart LR
    E[Energinet API] --> P[Python fetch + raw archive]
    P --> V[Validate timestamps, regions and values]
    V --> D[(PostgreSQL observations + run history)]
    D --> S[SQL summaries + interval gaps]
    S --> A[FastAPI]
    A --> U[Dashboard]
    G[Dagster schedule / backfill] --> P
```

## Run with Docker Compose

Prerequisites: Docker Engine running and Docker Compose available. Ports are bound to localhost. The example credentials are for local development.

```bash
docker compose up -d --build
docker compose exec api grid-report init
# Danish local dates; --end is exclusive. Example fixed historical day:
docker compose exec api grid-report ingest --start 2026-10-10 --end 2026-10-11
```

Open http://localhost:8000 and choose the imported day. API documentation: http://localhost:8000/docs. Dagster: http://localhost:3000. Enable `daily_schedule` in Dagster to import the previous local day at 06:15 Copenhagen time. Starting Dagster does **not** automatically enable the schedule.

For 30 days, pass your chosen start and exclusive end to the same command. The CLI processes one day at a time; interrupted backfills can safely be rerun. In Dagster, select `carbon_observations`, choose date partitions and launch a backfill.

```bash
docker compose exec api grid-report report --day 2026-10-10
docker compose logs api dagster
docker compose down
```

`down` stops services and preserves named volumes. Raw archives, PostgreSQL data and Dagster run history have separate persistent volumes. Do not use `down -v` unless you intend to delete them.

## Local Python development

Use Python 3.11 and Node.js 22.12+ (Node 22 is used in CI and Docker).
Run the API from the repository root. Linux/macOS:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python -m pip install --no-deps -e '.[dev]'
# Run just the database in Docker:
docker compose up -d db
# Defaults match the Compose database. To override, export DATABASE_URL.
.venv/bin/grid-report init
.venv/bin/python -m uvicorn grid_report.api:app --host 127.0.0.1 --port 8000
```

Windows PowerShell (no activation or execution-policy changes required):

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
.\.venv\Scripts\python.exe -m pip install --no-deps -e ".[dev]"
docker compose up -d db
.\.venv\Scripts\grid-report.exe init
.\.venv\Scripts\python.exe -m uvicorn grid_report.api:app --host 127.0.0.1 --port 8000
```

In a second terminal, on either platform:

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies `/api` and local font requests to FastAPI
on port 8000. These commands initialize an empty database; they do not import live data.
Use the explicit CLI/Compose ingestion commands above when you want source observations.

For a production build served directly by FastAPI, from the repository root on either platform:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
```

The build generates ignored `frontend/dist` and `src/grid_report/static/spa` artifacts.
Build before installing a Python wheel so it includes the SPA, or use an editable install
locally. FastAPI `/` returns an actionable 503 until a build exists; `/api` and local
fonts still work for Vite development. Docker's Node stage builds and packages the SPA
automatically before Python installation. No Node runtime is required in the final image.

`frontend/` uses React 19, Vite, TypeScript, Tailwind CSS 4 via `@tailwindcss/vite`,
and Recharts. It imports the tracked Hanken Grotesk/theme/layout CSS. The full-width
comparison chart aligns both regions by UTC instant; hover, touch and keyboard tooltips
show Copenhagen time and its offset, both exact readings and units. Missing intervals
break the lines; zeros remain real readings. Separate API requests are not one database snapshot.

In another terminal, activate the Python environment and run `dagster dev -m grid_report.definitions`. `.env.example` documents settings; the application reads environment variables, not `.env` automatically. Never commit real credentials.

## Verification

```bash
ruff check .
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
pytest -q
```

Database tests skip unless `GRID_TEST_DATABASE=1`. Use an **isolated test database** because integration fixtures truncate this project's tables:

```bash
export DATABASE_URL=postgresql://grid:grid@localhost:55432/grid_test
export GRID_TEST_DATABASE=1
pytest -q
```

On Windows PowerShell, set `$env:DATABASE_URL` and `$env:GRID_TEST_DATABASE = "1"`,
then use `.\.venv\Scripts\python.exe -m pytest -q`. Build the frontend first.

Create `grid_test` first, e.g. `docker compose exec db createdb -U grid grid_test`. GitHub Actions supplies an isolated PostgreSQL service automatically. Integration coverage includes replay, revised observations, failed imports preserving good data, SQL gaps, DST and API validation.

### Isolated Compose smoke test

Requires a running Docker Engine and Docker Compose **2.24.4 or newer**:

```bash
bash scripts/smoke_compose.sh
```

The script builds the images and starts PostgreSQL, FastAPI and Dagster with a unique project
name, disposable volumes and no published host ports. It checks database readiness, the
uninitialized-schema health response, schema initialization, healthy empty reports/series,
the compiled SPA HTML, hashed CSS/JS (including the chart chunk), packaged fonts, and
Dagster definitions plus the running webserver's code location.
It never ingests Energinet data or enables the schedule. Cleanup removes only this disposable
project's containers, network and volumes, including after failure or interruption; existing
development volumes and local databases are untouched. Image/dependency downloads still need
network access on a cold build. GitHub Actions runs this separately from PostgreSQL integration tests.

`/health` returns 200 only when the database is reachable and required reporting columns exist.
It returns 503 with `schema: not_ready` before initialization, or `database: unavailable` for
database failures. This checks connectivity and readable schema, not migrations, write access,
data freshness, completeness or full operational readiness.

Local verification on 2026-10-12: 74 Python tests passed against disposable PostgreSQL;
27 React/Vitest tests and Ruff passed. Windows and Linux production frontend builds
passed, as did Compose smoke. Real Edge/Playwright desktop hover and mobile tap checks
verified DST tooltip offsets, exact readings, zero/null and full-width responsive layout.
GitHub Actions for ingestion commit `ecc54f1` [completed successfully](https://github.com/misaelucas/gridscope/actions/runs/38233265942).
Compose smoke verification also passed, including image builds and container startup.
See [verification details](docs/VERIFICATION.md) for scope and limitations.

## Intentional boundaries

- One public source and five-minute dataset; no forecasting or machine learning.
- Imports update present records without deleting previously stored records absent from a later response. This protects against incomplete responses, but means reports reflect accumulated observations rather than a strict latest-source snapshot.
- Failed or incomplete runs remain visible. Missing intervals trigger a Dagster check; valid partial observations can still be inspected.
- Daily historical reporting, not a live freshness SLA. Latest observation and ingestion timestamps are exposed; no claim of real-time alerting.
- Dagster's `dev` server is appropriate locally. Production deployment needs separate daemon/webserver services, authentication, backups, secrets and monitoring.
- API is read-only and local by default; do not expose unauthenticated run errors/raw paths publicly.

Python **3.11** is the supported minor version for local development, Docker and CI
(`>=3.11,<3.12` in package metadata). Dependencies are pinned in `requirements.lock.txt`.
Regenerate and verify deliberately before changing the supported minor version. Image tags
and the CI runner are not digest-pinned; this is repeatable smoke coverage, not a bit-identical build.

### Docker-free local demo (optional)

If Docker is inactive, `pgserver` can run a bundled PostgreSQL server locally:

```bash
source .venv/bin/activate
pip install pgserver==0.1.4
python scripts/serve_local.py
```

In another terminal:

```bash
source .venv/bin/activate
export DATABASE_URL="$(cat data/local-db-url)"
grid-report ingest --start 2026-10-10 --end 2026-10-11
```

Open http://localhost:8017. The helper keeps its database under ignored `data/postgres`, writes a local connection URL with restricted file permissions, and stops the database when the helper exits. Do not run integration tests against this demo database.
