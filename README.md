# GridScope — Danish Electricity Carbon Intensity Analytics

A Python + PostgreSQL reporting pipeline for Danish electricity consumption carbon intensity. Uses public Energinet CO2Emis observations for DK1 and DK2; provides daily SQL summaries, missing-data checks, a read-only FastAPI service, a dashboard and Dagster orchestration.

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

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
# Run just the database in Docker:
docker compose up -d db
# Defaults match the Compose database. To override, export DATABASE_URL.
grid-report init
grid-report ingest --start 2026-10-10 --end 2026-10-11
uvicorn grid_report.api:app --host 127.0.0.1 --port 8000
```

In another terminal, activate the environment and run `dagster dev -m grid_report.definitions`. `.env.example` documents settings; the application reads environment variables, not `.env` automatically. Never commit real credentials.

## Verification

```bash
ruff check .
pytest -q
```

Database tests skip unless `GRID_TEST_DATABASE=1`. Use an **isolated test database** because integration fixtures truncate this project's tables:

```bash
export DATABASE_URL=postgresql://grid:grid@localhost:55432/grid_test
export GRID_TEST_DATABASE=1
pytest -q
```

Create `grid_test` first, e.g. `docker compose exec db createdb -U grid grid_test`. GitHub Actions supplies an isolated PostgreSQL service automatically. Integration coverage includes replay, revised observations, failed imports preserving good data, SQL gaps, DST and API validation.

## Intentional boundaries

- One public source and five-minute dataset; no forecasting or machine learning.
- Imports update present records without deleting previously stored records absent from a later response. This protects against incomplete responses, but means reports reflect accumulated observations rather than a strict latest-source snapshot.
- Failed or incomplete runs remain visible. Missing intervals trigger a Dagster check; valid partial observations can still be inspected.
- Daily historical reporting, not a live freshness SLA. Latest observation and ingestion timestamps are exposed; no claim of real-time alerting.
- Dagster's `dev` server is appropriate locally. Production deployment needs separate daemon/webserver services, authentication, backups, secrets and monitoring.
- API is read-only and local by default; do not expose unauthenticated run errors/raw paths publicly.

Dependencies used for verification are recorded in `requirements.lock.txt` (Python 3.11). Regenerate deliberately when upgrading; `pyproject.toml` defines compatible ranges.

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
