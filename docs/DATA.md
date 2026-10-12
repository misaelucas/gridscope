# GridScope — Data contract and reporting meaning

## Source evidence

- API guide: https://www.energidataservice.dk/guides/api-guides
- Live dataset metadata: https://api.energidataservice.dk/meta/dataset/CO2Emis
- Dataset: https://www.energidataservice.dk/tso-electricity/co2emis
- Terms: https://www.energidataservice.dk/terms

Metadata checked 2026-10-12: Energinet describes preliminary near-real-time CO₂ intensity of electricity **consumed** in Denmark, measured in g/kWh, at five-minute resolution. Source data are based on upscaled real-time measurements; errors can occur and generally are not corrected. Do not claim these are certified final emissions or generation-only intensity. Consult the source's current terms before redistribution.

## Fields

| Upstream field | Stored field | Meaning |
|---|---|---|
| Minutes5UTC | observed_at | Start of a five-minute interval, interpreted explicitly as UTC |
| PriceArea | area | DK1 or DK2 |
| CO2Emission | intensity | g CO₂/kWh; finite, nonnegative |
| Minutes5DK | not stored | Display-local timestamp; avoid using it as a unique key because clocks repeat during DST |

Identity is `(observed_at, area)`. Reimporting a day updates existing identities. `run_id` links each stored reading to the import that last wrote it. Raw responses are saved per run and page.

The source API's `start` and `end` filters use Danish local dates, with end excluded. We send local calendar dates to the API but convert local midnights to UTC for validation and SQL. Never assume every local day has 288 intervals: spring-forward has 276 and fall-back has 300.

## Quality and failure policy

Malformed, null, negative or nonfinite values, unexpected regions, duplicate identities, out-of-range timestamps and non-five-minute alignment fail the entire import. Valid but incomplete days succeed with visible gaps. Run status answers whether ingestion succeeded; completeness answers whether all expected observations exist. These are different questions.

SQL builds the expected timeline with `generate_series`, crosses it with both regions and LEFT JOINs actual readings. This is why a completely missing DK2 still appears in a report. `AVG` ignores missing readings; it returns NULL when none exist. A genuine zero is retained.

Report averages are unweighted averages of available five-minute readings. They cannot estimate total emitted CO₂ without consumption energy data. Completeness describes stored observations accumulated from successful imports. Previous readings are retained if a later response omits them; see the README's boundaries.

## Read-only API and dashboard contract

FastAPI response models validate returned fields and expose their types in `/docs`.
Existing field names, wrappers, nulls and timestamp offset formatting are preserved.

- `/api/reports?day=YYYY-MM-DD` returns the requested day, Copenhagen timezone, source,
  unit and `regions` in DK1, DK2 order. Counts describe expected and stored intervals;
  averages/minima/maxima and observation/ingestion timestamps are null for an empty region.
- `/api/series?day=YYYY-MM-DD&area=DK1` (default DK1; DK2 also supported) returns the
  day, area and all expected `observations`, ordered chronologically by instant. Each
  contains an offset-aware ISO timestamp and numeric intensity or null for a gap.
  A genuine zero stays numeric zero. Normal, spring and autumn days have 288, 276
  and 300 slots respectively; repeated local clock labels are distinct UTC instants.
- `/api/runs` remains an array of the latest 20 attempts, ordered by descending
  `started_at` (ties have no guaranteed order), across all report days. UUIDs and local
  dates are strings; timestamps are offset-aware ISO strings. Status is `running`,
  `success` or `failed`. `finished_at`, `received` and `error` can be null. Existing
  `archive_path` and error fields remain available, so the API remains local by default.

Each endpoint reads independently: separate report, DK1/DK2 series and history requests
do **not** provide one database snapshot. An import committed between requests can make
their results differ. The dashboard renders only the latest submitted request group,
but that does not add cross-endpoint transactional consistency.

Changing the selected date immediately clears cards, chart and history and cancels pending
work. Submitting fetches stored data; only the current request group may render or display
an error. Failed loads clear all dependent displays. Default yesterday is calculated by
finding today's Copenhagen calendar date and then subtracting one calendar day, including
DST boundaries. Selection alone does not fetch, and the dashboard does not poll the source.

The React chart merges DK1 and DK2 by the numeric UTC instant of each timestamp, takes
the union of slots and sorts chronologically. Missing region readings remain null;
all expected 276/288/300 five-minute slots are retained. The numeric time axis does not
collapse the repeated autumn local clock labels. Lines are linear between adjacent valid
observations and never bridge null slots. Hover/touch/keyboard tooltips show the full
Copenhagen date and time (including seconds), explicit UTC offset, both region readings
and g CO₂/kWh. Tooltip numbers retain their API precision; summary cards round to one
decimal as before. This is a presentation change, not interpolation or energy weighting.

## Pagination and concurrent updates

### Public historical demo export

`python -m grid_report.export_demo` reads existing reports and both series through the
read-only API, using the existing response models. It checks each complete expected
five-minute timeline against the Danish day, counts, completeness, latest observation
and aggregates. Inconsistent responses fail before any public files are written. This
agreement check does not establish a cross-endpoint database snapshot or source revision
freshness. Nulls and genuine zeros are preserved; missing observations are never invented.

The public manifest records dates, source attribution, units, timezone, export timestamp
and limitations. Sorted day JSON is addressed by a content-derived revision. Export
time is not observation time or an ingestion freshness guarantee. Run history is never
requested; model whitelisting removes extra fields and `last_ingested_at` is nulled.
Credentials, source archives, internal errors and filesystem paths are not published.

`VITE_DATA_MODE=static` uses only the manifest and its listed day files, with the same
React components and UTC alignment as API mode. It defaults to the newest available
historical date, hides operational history and labels the export as historical. A date
outside the manifest yields an empty state without a day-file request. Missing/invalid
JSON yields a recoverable error; there is no backend fallback. The included genuine
2026-10-09 export has 288 non-null slots per region, verified against the local API.
Synthetic DST/zero/null fixtures exist only in tests and are not part of this export.

### Database writes and source pagination

Database updates for the same Danish local day are serialized using a PostgreSQL
transaction-scoped advisory lock. The key is GridScope's fixed two-integer namespace
`1196575044` and the local date's ordinal. Different dates use different keys. The lock is
acquired after fetching and validation, on the connection that upserts observations and
marks the run successful; commit or rollback releases it. No database transaction is held
open during HTTP fetching. Missing rows in a later response remain stored.

This is write serialization, not source revision freshness: a previously fetched response
can acquire the lock later and overwrite a newer reading. Advisory locks coordinate only
writers using this protocol; direct SQL writers can bypass it. There is no production lock
timeout or automatic database retry policy.

The initial `running` history row commits before fetching. SQL failures roll back all
observation changes and the success status together, then a separate transaction records
`failed`. If failure recording also fails, the original exception is re-raised with a note
and the recording exception is logged with the run ID; history may remain `running`.
Process termination and ambiguous commit outcomes after connection loss still require
manual reconciliation. Raw archives are outside the database transaction.

Schema initialization uses a separate transaction-scoped key (namespace `1196575044`,
key `0`) to serialize cooperating `init_db` calls. `IF NOT EXISTS` alone is insufficient
for concurrent first creation. This is not a migration system or protection from external DDL.

Requests sort by UTC timestamp and region, advance offset and stop on a short page. The upstream `total` is not used as a reliable count of all matching rows. A 20-page cap bounds work. Historical complete-day imports reduce moving-window problems, but the API does not supply snapshot isolation. Duplicate keys are rejected rather than silently selecting an arbitrary version. Retries apply to transport failures, HTTP 429 and 5xx; other 4xx fail immediately.

Each page allows at most four attempts. Retry waits use exponential backoff and accept
`Retry-After` delta-seconds or HTTP dates. Missing, invalid, negative or past values fall back
to backoff. Each delay is capped at 30 seconds; all pages share a 60-second cumulative sleep
budget per daily fetch. Once that budget is exhausted, the next failure is raised without
retrying. These bounds cover requested retry sleeps, not total HTTP or filesystem execution time.

Successful HTTP responses retain their exact raw bytes, including malformed payloads for
diagnosis. Failed HTTP attempts produce separate `failure-PAGE-ATTEMPT.json` diagnostics with
only page, attempt and status code. Transport failures use a boolean flag instead of the exception
message. Failure bodies, URLs and request/response headers are deliberately omitted because they
may contain or echo secrets. Payload-shape and JSON errors fail immediately without retries.
