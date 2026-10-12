# GridScope — Verification — 2026-10-12

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
