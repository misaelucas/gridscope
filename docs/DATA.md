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

## Pagination and concurrent updates

Requests sort by UTC timestamp and region, advance offset and stop on a short page. The upstream `total` is not used as a reliable count of all matching rows. A 20-page cap bounds work. Historical complete-day imports reduce moving-window problems, but the API does not supply snapshot isolation. Duplicate keys are rejected rather than silently selecting an arbitrary version. Retries apply to transport failures, HTTP 429 and 5xx; other 4xx fail immediately.
