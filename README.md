# GridScope — Danish Electricity Carbon Intensity Analytics

A Python + PostgreSQL reporting pipeline for Danish electricity consumption carbon intensity. Uses public Energinet CO2Emis observations for DK1 and DK2; provides daily SQL summaries, missing-data checks, a read-only FastAPI service, a React dashboard and Dagster orchestration.

The same React application also builds as an independent **static historical demo** for
Cloudflare Pages. It uses committed, validated Energinet observations rather than a live
backend. The full application and its ingestion/orchestration remain available locally.

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

## Local development: Python API and React frontend

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

For local Dagster, run `.venv/bin/dagster dev -m grid_report.definitions` on Linux/macOS
or `.\.venv\Scripts\dagster.exe dev -m grid_report.definitions` on Windows.
`.env.example` documents `DATABASE_URL` and `RAW_DIR`; the application reads environment
variables, not `.env` automatically. Set them before starting a process. Never commit real credentials.

## Static historical demo: Cloudflare Pages

Static mode reuses the dashboard, date picker and interactive chart. It fetches only
`/demo/v1/manifest.json` and the manifest's versioned daily JSON; no FastAPI service,
database or Dagster deployment is needed. It defaults to the newest **available observation
date**, not yesterday. Unavailable dates produce an informative empty state without
requesting a nonexistent day file. Operational run history and ingestion timestamps are
excluded. API mode remains the default when `VITE_DATA_MODE` is unset or `api`.

The committed export contains genuine local Energinet data for **2026-10-09**:
288 observations in DK1 and 288 in DK2, each 100% complete at export. Reports and series
were checked against each other, including aggregates and complete expected timelines.
The manifest records the actual export timestamp, units, source and limitations. This is
historical data, **not a live feed**; exporting now does not make observations fresh.
No synthetic observations are included in the public demo. DST and gaps are tested with
separate, unpublished fixtures.

Build locally (Linux/macOS):

```bash
npm --prefix frontend ci
VITE_DATA_MODE=static npm --prefix frontend run build
node frontend/scripts/check-static.mjs
npm --prefix frontend run preview
```

Windows PowerShell:

```powershell
npm --prefix frontend ci
$env:VITE_DATA_MODE = "static"
npm --prefix frontend run build
node frontend/scripts/check-static.mjs
npm --prefix frontend run preview
# Remove the variable before your next API-mode build:
Remove-Item Env:VITE_DATA_MODE
```

Preview at http://127.0.0.1:4173. Static builds use root-relative assets, include fonts
and public JSON, and do not overwrite the generated Python SPA package. A static build
fails if an exported manifest or a listed day file is missing. Static Vite development
also works with `VITE_DATA_MODE=static npm --prefix frontend run dev` (PowerShell: set
the variable as above); it serves the local export and fonts without a backend.

### Refreshing genuine data

Start the existing API with the desired dates already imported, then export read-only:

```bash
# Linux/macOS; repeat --day to include more dates:
.venv/bin/python -m grid_report.export_demo --api-url http://127.0.0.1:8000 --day 2026-10-09 --output frontend/demo
```

```powershell
.\.venv\Scripts\python.exe -m grid_report.export_demo --api-url http://127.0.0.1:8000 --day 2026-10-09 --output frontend/demo
```

The exporter fetches only reports and both series, validates existing Pydantic contracts,
checks chronological five-minute timelines, zero/null values, counts and aggregates,
and rejects inconsistent responses. It never imports data, requests run history, fills
gaps or exports API URLs, credentials, raw archives, internal errors or filesystem paths.
`last_ingested_at` is nulled to retain the report type without publishing operational
timestamps. It writes sorted JSON under a content-derived revision and publishes the
manifest last. Identical data produces the same revision; the export timestamp changes.
Separate API endpoints do not share a database snapshot, so retry if concurrent ingestion
causes a consistency failure. Commit the new public manifest/day files after reviewing
them, then rebuild. Only manifest-listed files are included in the static build.

### Pages configuration (manual deployment only)

| Setting | Value |
|---|---|
| GitHub repository | `misaelucas/gridscope` |
| Production branch | `main`, after reviewing and merging this feature |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `VITE_DATA_MODE=static` |
| Node environment | `NODE_VERSION=22` |
| Optional social URL | `VITE_SITE_URL=https://YOUR-PROJECT.pages.dev` or your actual custom origin |

Configure these settings yourself in Cloudflare Pages; no account connection or
deployment is performed by this change. The output uses Pages' default SPA fallback
(no top-level `404.html`) for direct navigation and refresh. Generated `_headers` restrict
scripts and connections to the same origin, retain local fonts and permit future iframe
embedding by `https://misaa.dev` and `https://www.misaa.dev`. No Workers or extra cloud
services are required. See Cloudflare's [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
and [headers documentation](https://developers.cloudflare.com/pages/configuration/headers/).
Cloudflare deployment itself remains unverified until you deploy.

### Portfolio integration

Suggested description: **GridScope explores Danish electricity carbon intensity through
interactive five-minute charts, explicit data-gap reporting and Copenhagen-aware time
handling. The public demo presents genuine historical Energinet observations; the full
project includes validated Python ingestion, PostgreSQL analytics and Dagster orchestration.**

Technology tags: React 19, TypeScript, Vite, Tailwind CSS 4, Recharts, Python, PostgreSQL,
FastAPI, Dagster, Docker, GitHub Actions, Cloudflare Pages.

Link the deployed URL from `https://misaa.dev`, labeling it “Historical demo” and linking
the repository separately for the complete architecture. For a later embed, use an
iframe with an accessible title such as `GridScope historical electricity carbon intensity`;
its content is responsive but does not automatically resize the parent iframe. Set
`VITE_SITE_URL` to the actual deployed origin and rebuild for absolute Open Graph preview
URLs. The build includes title/description metadata and a local social-preview PNG.
No changes to the portfolio repository are needed here.

## Reporting and ingestion guarantees

- A Danish local day is bounded by Copenhagen midnights converted to UTC. Expected
  five-minute counts per region are **276, 288 or 300**, depending on DST.
- Observation identity is `(observed_at, area)`. Replays upsert present readings and
  retain previously stored readings absent from a later response. Duplicate identities,
  malformed values and timestamps outside the requested day fail the import.
- HTTP fetching and validation finish before the observation transaction opens.
  A transaction-scoped PostgreSQL advisory lock serializes writes for the same local
  day on the writing connection; different dates have independent lock keys.
- Observation upserts and the success status commit together. SQL failures roll them
  back together; failure history is then recorded in a separate transaction. The initial
  `running` row commits before fetching. Failure-recording errors preserve the original
  exception with diagnostics, but may leave a run marked `running`.
- Serialization does **not** guarantee newest-source ordering: an older fetched
  response can acquire the lock later. Direct SQL writers can bypass the protocol.
  Cooperating schema initialization also uses an advisory lock; this is not a migration system.
- Raw page archives are outside database transactions. Process termination or an
  ambiguous commit after connection loss may require manual reconciliation.

SQL generates the expected timeline for both regions, including a wholly missing
region. Missing readings are `null`; real zeros remain numeric zero. Summaries use
available readings and round only for display. Ingestion success and completeness
are separate measures. See [the data contract](docs/DATA.md) for validation, bounded
HTTP retry behavior, pagination and archival details.

## Read-only API and dashboard behavior

| Endpoint | Result |
|---|---|
| `/api/reports?day=YYYY-MM-DD` | Daily counts, completeness, average, peak, minimum and timestamps, in DK1/DK2 order |
| `/api/series?day=YYYY-MM-DD&area=DK1` | Chronological expected five-minute slots, including null gaps; area defaults to DK1 |
| `/api/runs` | Latest 20 ingestion attempts across all days, including status, timestamps and errors |
| `/health` | Database connectivity and required reporting schema readiness |
| `/docs` | OpenAPI documentation with explicit response models |

Timestamps are offset-aware ISO strings. The React dashboard uses stored data only;
requests never trigger ingestion or poll Energinet. It starts on yesterday's Copenhagen
calendar date. Editing the date clears dependent displays and cancels pending requests;
submitting loads the selection. Request identity checks prevent stale responses from
overwriting a newer selection. Failed loads clear cards, chart and ingestion history.

The chart aligns regions by UTC instants, preserving repeated autumn clock times.
It never connects lines across missing readings. Its custom tooltip shows the exact
Copenhagen date/time, UTC offset, DK1 and DK2 values and g CO₂/kWh units.
Separate endpoints read independently and do not provide a shared database snapshot.

## Repository layout

| Path | Responsibility |
|---|---|
| `src/grid_report/source.py`, `domain.py` | Fetch/archive source pages and validate observations/local-day bounds |
| `src/grid_report/pipeline.py`, `db.py`, `sql/` | Run lifecycle, atomic upserts, locking, schema and reporting queries |
| `src/grid_report/api.py`, `cli.py`, `definitions.py` | FastAPI, CLI and Dagster entry points |
| `src/grid_report/static/` | Packaged fonts, baseline `fonts.css`, `theme.css`, `dashboard.css` and generated SPA |
| `frontend/src/` | React components, API loading, UTC series alignment and Copenhagen date formatting |
| `frontend/src/test/`, `tests/` | React/DOM tests and Python/PostgreSQL integration coverage |
| `scripts/smoke_compose.sh` | Disposable full-stack smoke checks |
| `docs/` | Data semantics, learning walkthrough, verification history and screenshot baseline |

Generated frontend artifacts and `node_modules` are ignored. Python dependencies use
`requirements.lock.txt`; frontend dependencies use `frontend/package-lock.json` and
`npm ci`. The Docker build compiles the frontend in Node 22, then packages it with
Python and local fonts in the final non-root runtime image.

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

For a disposable PostgreSQL instance separate from Compose development volumes:

```sh
docker run --name gridscope-test-db --rm -d -e POSTGRES_USER=grid -e POSTGRES_PASSWORD=grid -e POSTGRES_DB=grid_test -p 127.0.0.1:55433:5432 postgres:17-alpine
docker exec gridscope-test-db pg_isready -U grid -d grid_test
```

Wait until `pg_isready` reports accepting connections. Use port **55433** in the test
URL (`postgresql://grid:grid@localhost:55433/grid_test`), enable `GRID_TEST_DATABASE=1`,
then run pytest. Afterwards, `docker stop gridscope-test-db` removes this disposable
container. Choose another unused name/port if needed. Never point these tests at the
development database. GitHub Actions supplies its own isolated PostgreSQL service.

Coverage includes deterministic same-day serialization, different-day independence,
failures after writes, success-status failures, incomplete replay retention, aggregates,
populated API contracts, run history, zero/null and DST. React Testing Library/Vitest
cover stale loads, cancellation, failures/recovery, populated/empty states, UTC merging
and Recharts mouse/touch tooltips.

Optional real-browser verification is `node frontend/scripts/browser-check.cjs` against
a running production SPA (default `http://127.0.0.1:8000`). It requires Playwright and a
browser available in the environment; they are not project dependencies. Override
`GRID_BROWSER_URL` and `GRID_BROWSER_EXECUTABLE` as needed. The script intercepts API
requests with synthetic DST fixtures and saves ignored screenshots in
`frontend/browser-artifacts`; it does not import source data.

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

Local verification on 2026-10-12: **84 Python tests passed** against disposable PostgreSQL
(one existing Starlette/httpx warning); **35 React/Vitest tests** and Ruff passed.
Windows and Linux API/static production builds passed, as did isolated Compose smoke.
Real Edge/Playwright desktop hover and mobile tap checks verified production static
data, refresh/deep links, CSP, exact readings, unavailable dates, failed-load recovery
and zero backend requests. Unit tests also verify DST offsets, real zero/null and gaps.
GitHub Actions for ingestion commit `ecc54f1` [completed successfully](https://github.com/misaelucas/gridscope/actions/runs/38233265942).
GitHub Actions for React commit `ea9cc8e` also [completed successfully](https://github.com/misaelucas/gridscope/actions/runs/38239260984),
including the Python/frontend job and isolated Compose smoke. This result applies to
that commit, not to subsequent changes. Real-browser verification used Edge; Safari,
Firefox and physical mobile devices were not tested. Native Windows Compose smoke was
not run; smoke used Linux containers. Shell scripts are checked out with LF through
`.gitattributes`. No real Energinet import was performed during frontend verification.
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
npm --prefix frontend ci
npm --prefix frontend run build
python scripts/serve_local.py
```

In another terminal:

```bash
source .venv/bin/activate
export DATABASE_URL="$(cat data/local-db-url)"
grid-report ingest --start 2026-10-10 --end 2026-10-11
```

Open http://localhost:8017. The helper keeps its database under ignored `data/postgres`, writes a local connection URL with restricted file permissions, and stops the database when the helper exits. Do not run integration tests against this demo database.
