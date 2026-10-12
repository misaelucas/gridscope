# GridScope — Learn by following one observation

Read this in order with the files open beside it. The objective is to explain and change the project yourself, including code initially written with assistance.

## 1. Model the problem — `src/grid_report/domain.py`

Start with this example record:

```python
{"Minutes5UTC": "2026-10-09T22:00:00", "PriceArea": "DK1", "CO2Emission": 128.0}
```

`normalize` turns an untrusted dictionary into an `Observation` dataclass. A frozen dataclass is a small immutable record: after validation, downstream functions can trust its fields. A missing JSON timezone is interpreted as UTC because that is the field's documented meaning, not because the machine happens to be in UTC.

At that date, 22:00 UTC is midnight in Copenhagen, so the observation belongs to local October 10. `day_bounds` constructs the two local midnights separately before converting each to UTC. Subtracting UTC instants gives real elapsed time across a clock change.

**Try:** run `pytest -q tests/test_domain.py`. Explain why March 29 has 276 intervals and October 25 has 300. Add a test rejecting a timestamp at `22:01`.

## 2. Extract and preserve — `src/grid_report/source.py`

`fetch_day` accepts an HTTP client instead of constructing one. This dependency injection lets tests substitute `httpx.MockTransport` without contacting Energinet. Production uses a client with an explicit timeout.

Each page is written to disk before normalization. If upstream changes a field, the original response survives for investigation. A run UUID prevents the next attempt from overwriting that evidence.

Read the nested loops: the outer loop advances pages; the inner loop retries one request.
Retries use exponential delay and accept numeric or HTTP-date Retry-After values, capped at
30 seconds per delay and a shared 60-second sleep budget. Failure diagnostics retain status
and attempt information without bodies or headers. Permanent HTTP client errors are not retried.
Pagination sorts by the complete observation identity so page ordering is stable where the
source data are stable.

**Try:** open `tests/test_source.py`. Trace the offsets `[0, 1]` when page size is one.
Follow the 429 retry and shared waiting-budget tests. What happens if the server always returns
a full page? What snapshot guarantee is still missing?

## 3. Define storage rules — `sql/schema.sql`, then `db.py`

Two tables answer different questions: observations contain current readings; ingestion_runs records attempts and failures. A foreign key connects the current observation to its writing run.

The composite primary key enforces uniqueness in the database. Python validation gives readable errors; SQL constraints protect the table from other writers too. `timestamptz` represents an instant, rather than an ambiguous local wall-clock value.

`with connect() as conn` commits on normal exit and rolls back on exceptions. Query values use `%s` placeholders and separate parameters. Never use string interpolation to insert user data into SQL.

`init_db` takes a transaction-scoped PostgreSQL advisory lock before executing schema SQL.
This serializes concurrent first initialization; `IF NOT EXISTS` alone can still race in
PostgreSQL's catalogs. The initialization key is separate from all date keys. External DDL
and schema upgrades still need deliberate coordination and migrations.

**Try:** locate each database constraint and its corresponding Python rule. Explain why the run record is committed before downloading begins.

## 4. Make imports repeatable — `pipeline.py`, then `cli.py`

Trace `ingest_day`: create run → download → normalize all rows → validate day and uniqueness → transactionally upsert observations and finish run. `ON CONFLICT ... DO UPDATE` makes replay safe and accepts changed values for an existing interval.

The whole batch is fetched and validated before opening the write transaction. On that
same connection, `db.lock_day` takes a transaction-scoped advisory lock keyed by the Danish
local date. Same-day writers wait until commit or rollback; different dates proceed
independently. The observation update and success status share the protected transaction.
Failure is recorded using a separate transaction so the failure history survives rollback.
If recording fails too, the original exception survives with a diagnostic note and a log
containing the run ID and recording exception. The run can remain `running` in that case.

Lock order does not establish source revision freshness: a slower fetch may overwrite newer
values. Cooperating writers must use the same lock protocol. There is no production wait
timeout, abandoned-run recovery or reconciliation of ambiguous network/commit outcomes.

An incomplete response does not delete old data. This is a deliberate accumulated-data policy, documented in DATA.md. It is not a source snapshot or a full history of every revision. A killed process may leave a run marked running; recovery of abandoned runs is future work.

The CLI loops over local dates with an exclusive end. Import a single day first, rerun it, and compare the count with the number of successful runs.

**Try:** read `test_replay_revision_and_gaps`. Explain why three ingestion runs still leave one observation. Run the failure test and inspect the archived response.

The SQL failure tests use triggers after observation writes and during success-status updates.
A PostgreSQL sequence survives rollback and proves that writes happened before the injected
error. Full row snapshots prove values, provenance and timestamps rolled back. Concurrency
tests use events and server lock inspection with bounded waits, rather than timing sleeps.

## 5. Report the gaps — `sql/report.sql`

Read each common table expression (CTE) in order:

1. `slots` generates all expected five-minute UTC instants for the local day.
2. `areas` creates DK1 and DK2 even if either has no data.
3. `CROSS JOIN` creates every expected interval-region pair.
4. `LEFT JOIN` attaches matching readings without losing missing pairs.
5. Aggregates count actual readings and compute available-reading statistics.

`count(*)` counts expected pairs; `count(o.intensity)` counts non-null observations. Their difference is missing data. `AVG` does not turn NULL into zero. The SQL's result should agree with `expected_intervals` in the domain tests on DST days.

**Try:** temporarily remove the LEFT JOIN and explain which reports become misleading. Restore it. Add a SQL metric for intervals over a chosen intensity threshold and define whether the denominator is observed or expected intervals.

## 6. Serve useful results — `api.py`, then `frontend/src/`

FastAPI converts query parameters to typed dates and validates region names. Ordinary `def` endpoints perform blocking database work in FastAPI's thread pool. They read stored data; dashboard visitors never cause source downloads.

In API mode the browser requests summary, series and runs. Series includes NULLs so the SVG line breaks at missing intervals. React renders text values safely. The dashboard labels source limitations because a plausible chart can still mislead if its measurements are misunderstood.

Response models in `api.py` describe the existing JSON fields, nullable readings, dates,
offset-aware timestamps, UUIDs and run statuses. PostgreSQL integration tests inspect
populated HTTP responses, not only database helper results: they distinguish zero from
null, verify region/series/history ordering and exercise both DST day lengths.

`App.tsx` aborts the previous request group and increments a request ID on a new load or
date edit. It clears cards, chart and history immediately. Before rendering or reporting
an error it checks that the ID and selected date still match; cancellation is quiet.
The ID check also protects against responses that finish despite cancellation. Date edits
clear the display without fetching until submission. This coordinates browser state;
the separate endpoints still read independent database snapshots.

Default yesterday first extracts today's calendar date in Europe/Copenhagen, then uses
UTC calendar arithmetic on that date. Subtracting 24 elapsed hours from the current
instant can select the wrong day around DST. `time.ts` centralizes calendar dates and
offset-aware Copenhagen labels. `api.ts` joins the two series by UTC instants; repeated
clock labels stay distinct. `CarbonChart.tsx` uses Recharts with null gaps and a custom
tooltip. Components in `Report.tsx` share the date picker, summaries, sections and history.

Run `npm ci`, `npm test` and `npm run build` inside `frontend/` with Node 22.12+.
Vitest and React Testing Library exercise stale requests, failures/recovery, rendering,
zero/null, 276/288/300 slots and real Recharts hover/touch events. The optional
`frontend/scripts/browser-check.cjs` uses an available Playwright/browser installation
against `GRID_BROWSER_URL` (default API port 8000); `GRID_BROWSER_EXECUTABLE` can select
a system browser. It intercepts all API requests with synthetic observations, checks
desktop hover/mobile taps and writes ignored screenshots to `frontend/browser-artifacts`.
No real source ingestion occurs in these tests.

**Try:** visit `/docs`, request an invalid date and inspect the 422 response. Request a day with no data: both regions should show no average and 0% completeness. Explain why stale data can still be useful if its timestamp is visible.

### CSS structure — based on bottenmisa

The dashboard follows `/home/misa/repositorios/bottenmisa`, the user's required CSS baseline:

- `static/fonts.css`: local Hanken Grotesk, the same family and 400/500/900 weights as `BaseHead.astro`.
- `static/theme.css`: the original `--body-*`, `--text-*`, and `--brand-*` token names and values from `src/styles/theme.css`, with unrelated article/chat styles omitted.
- `static/dashboard.css`: page width, typographic scale, thin dividers, subtle grid and responsive spacing adapted from `Layout.astro` and `PortfolioPage.astro`.
- `frontend/src/styles.css`: imports these three tracked CSS files and Tailwind utilities,
  without a preflight reset; only the full-width comparison and tooltip rules are added.
- `frontend/src/components/CarbonChart.tsx`: SVG colors use the same CSS tokens, so graph
  and page share one palette. The tracked screenshot remains the visual baseline.

**Try:** change a series token in `theme.css` and reload. Both the legend and chart should change together. Add a metric using the existing typography and divider rules rather than creating a separate card style.

Vite proxies the read-only endpoints and fonts during development. Its production base is
`/static/spa/`; the build copies hashed assets and HTML into the ignored Python static
package directory. Docker builds them in Node 22 before installing Python, and package-data
includes the generated entry point/chunks plus the existing fonts. The smoke test inspects
compiled HTML and fetches every generated JS/CSS chunk and packaged font.

### One dashboard, two data adapters

`staticData.ts` loads a versioned historical manifest/day file when
`VITE_DATA_MODE=static`; `api.ts` otherwise keeps the original read-only endpoints.
Both return the same report/merged-point representation to React. Static mode has
no operational runs, starts on an available date and labels export time separately
from observation time. It never falls back to an absent backend. The existing abort
controller/request identity logic protects both modes.

Follow `export_demo.py`: parse the existing API models → validate full Copenhagen-day
UTC timelines → recompute counts/aggregates → remove operational metadata → encode
sorted JSON → derive a revision → publish the manifest last. Real nulls survive; the
exporter does not manufacture data. Separate responses still are not a database snapshot.
`tests/test_export_demo.py` tests this with unpublished fixtures; the committed public
export was produced from the local API's genuine 2026-10-09 readings.

Static Vite builds use `/` as the base, package local fonts and copy only manifest-listed
JSON. API builds retain `/static/spa/` and Python packaging. Static builds do not overwrite
that Python package. `pages/_headers` supplies a same-origin CSP with explicit portfolio
iframe origins. Social metadata uses `VITE_SITE_URL` when an actual public origin is known.
No Cloudflare account is connected and no deployment occurs in this workflow.

**Try:** build with static mode using the README's platform-specific commands, then run
`node frontend/scripts/check-static.mjs`. With Playwright and a browser available,
`node frontend/scripts/browser-static.cjs` serves only `dist` and checks desktop/touch
tooltips, refresh, assets, unavailable dates, missing JSON recovery and zero API requests.
The local server emulates SPA fallback and applies the generated CSP; it does not prove
Cloudflare's deployed configuration. Compare the static and API builds' asset paths.

## 7. Orchestrate existing logic — `definitions.py`

An asset represents a data product. Daily partitions identify independent local dates. Dagster calls the same `ingest_day` function as the CLI; business rules should not be copied into scheduler code.

The schedule chooses yesterday at 06:15 Copenhagen time. The completeness check reads stored data and reports missing intervals. A successful download can still produce a failed quality check. Valid partial data remains available for diagnosis.

**Try:** materialize one day in Dagster, inspect metadata and the check, then select multiple partitions for a backfill. Read the logs to follow the same functions as the CLI.

## 8. Verify behavior — `tests/`, then `.github/workflows/test.yml`

Unit tests need no database. Integration tests use real PostgreSQL to exercise transactions, upserts, timezones and SQL. The explicit environment flag protects you from accidentally truncating your ordinary development database. CI creates its own isolated service.

**Try:** deliberately break the upsert, run integration tests and explain the failure. Restore the implementation. Add a test that a malformed second row leaves the previously valid database untouched.

## Next extensions, after you can explain this version

- Add generation or consumption data with its own documented units and interval contract.
- Compute energy-weighted carbon intensity only once consumption alignment is correct.
- Add configurable freshness checks and explicit stale status.
- Introduce database migrations before changing a deployed schema.
- Track per-observation revision history if exact historical provenance is needed.
- Add overlapping-window recovery, abandoned-run handling and retry policies for unattended operation.

Keep changes small. For each one: state the behavior, write a meaningful failing test where warranted, implement it, run the checks, and explain the tradeoff in your own words.
