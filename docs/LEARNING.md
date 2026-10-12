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

Read the nested loops: the outer loop advances pages; the inner loop retries one request. Retries use exponential delay and respect numeric Retry-After values. Permanent HTTP client errors should not be retried. Pagination sorts by the complete observation identity so page ordering is stable where the source data are stable.

**Try:** open `tests/test_source.py`. Trace the offsets `[0, 1]` when page size is one. Add a test showing a 429 response retries. What happens if the server always returns a full page? What snapshot guarantee is still missing?

## 3. Define storage rules — `sql/schema.sql`, then `db.py`

Two tables answer different questions: observations contain current readings; ingestion_runs records attempts and failures. A foreign key connects the current observation to its writing run.

The composite primary key enforces uniqueness in the database. Python validation gives readable errors; SQL constraints protect the table from other writers too. `timestamptz` represents an instant, rather than an ambiguous local wall-clock value.

`with connect() as conn` commits on normal exit and rolls back on exceptions. Query values use `%s` placeholders and separate parameters. Never use string interpolation to insert user data into SQL.

**Try:** locate each database constraint and its corresponding Python rule. Explain why the run record is committed before downloading begins.

## 4. Make imports repeatable — `pipeline.py`, then `cli.py`

Trace `ingest_day`: create run → download → normalize all rows → validate day and uniqueness → transactionally upsert observations and finish run. `ON CONFLICT ... DO UPDATE` makes replay safe and accepts changed values for an existing interval.

The whole batch is validated before writing. The observation update and success status share a transaction. Failure is recorded using a separate transaction so the failure history survives rollback.

An incomplete response does not delete old data. This is a deliberate accumulated-data policy, documented in DATA.md. It is not a source snapshot or a full history of every revision. A killed process may leave a run marked running; recovery of abandoned runs is future work.

The CLI loops over local dates with an exclusive end. Import a single day first, rerun it, and compare the count with the number of successful runs.

**Try:** read `test_replay_revision_and_gaps`. Explain why three ingestion runs still leave one observation. Run the failure test and inspect the archived response.

## 5. Report the gaps — `sql/report.sql`

Read each common table expression (CTE) in order:

1. `slots` generates all expected five-minute UTC instants for the local day.
2. `areas` creates DK1 and DK2 even if either has no data.
3. `CROSS JOIN` creates every expected interval-region pair.
4. `LEFT JOIN` attaches matching readings without losing missing pairs.
5. Aggregates count actual readings and compute available-reading statistics.

`count(*)` counts expected pairs; `count(o.intensity)` counts non-null observations. Their difference is missing data. `AVG` does not turn NULL into zero. The SQL's result should agree with `expected_intervals` in the domain tests on DST days.

**Try:** temporarily remove the LEFT JOIN and explain which reports become misleading. Restore it. Add a SQL metric for intervals over a chosen intensity threshold and define whether the denominator is observed or expected intervals.

## 6. Serve useful results — `api.py`, then `static/app.js`

FastAPI converts query parameters to typed dates and validates region names. Ordinary `def` endpoints perform blocking database work in FastAPI's thread pool. They read stored data; dashboard visitors never cause source downloads.

The browser requests summary, series and runs. Series includes NULLs so the SVG line breaks at missing intervals. `textContent` displays values safely. The dashboard labels source limitations because a plausible chart can still mislead if its measurements are misunderstood.

**Try:** visit `/docs`, request an invalid date and inspect the 422 response. Request a day with no data: both regions should show no average and 0% completeness. Explain why stale data can still be useful if its timestamp is visible.

### CSS structure — based on bottenmisa

The dashboard follows `/home/misa/repositorios/bottenmisa`, the user's required CSS baseline:

- `static/fonts.css`: local Hanken Grotesk, the same family and 400/500/900 weights as `BaseHead.astro`.
- `static/theme.css`: the original `--body-*`, `--text-*`, and `--brand-*` token names and values from `src/styles/theme.css`, with unrelated article/chat styles omitted.
- `static/dashboard.css`: page width, typographic scale, thin dividers, subtle grid and responsive spacing adapted from `Layout.astro` and `PortfolioPage.astro`.
- `static/app.js`: SVG colors read the CSS tokens with `getComputedStyle` so graph and page share one palette.

**Try:** change a series token in `theme.css` and reload. Both the legend and chart should change together. Add a metric using the existing typography and divider rules rather than creating a separate card style.

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
