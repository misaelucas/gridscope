# GridScope — Verification — 2026-10-12

## Shell checkout portability — 2026-10-12

Windows Git had `core.autocrlf=true`, no attributes rule, and an LF index blob but CRLF
working copy for `scripts/smoke_compose.sh`. Added only `*.sh text eol=lf` to
`.gitattributes`. Scoped `git add --renormalize -- scripts/smoke_compose.sh` produced
no tracked script change: its SHA-1 remains `dc194b39a154832c4d703991d0eac958202a3ddf`
and mode remains `100755`. Rechecking out that script restores LF without rewriting
unrelated files. Attributes do not automatically rewrite existing working copies.

Verified a fresh Windows Git index checkout of all staged files to a new temporary
directory with `core.autocrlf=true`: the script contains zero CR bytes and its raw hash
matches the original index blob. Checks used that checkout directly, mounted read-only;
no `sed`, copying/normalization workaround or application changes were needed.

- Windows Git Bash `bash -n scripts/smoke_compose.sh`: **exit 0**.
- Linux Bash syntax check and full isolated Compose smoke: **exit 0**. Image builds,
  schema health, API/assets and Dagster checks passed; scoped containers/network/volumes
  were removed. Full smoke ran through a disposable Linux Docker CLI helper using the
  fresh Windows checkout directly. Native Windows Bash/Compose path handling was not
  tested; the Windows verification here covers checkout bytes and Bash syntax.
- Full Python suite against a new disposable PostgreSQL 17.11 database:
  **72 passed, 1 warning in 4.40s** (existing Starlette/httpx deprecation).
- Dashboard tests on Node 22.23.3: **13 passed, 0 failed**.
- `ruff check --no-cache .`: **All checks passed**.
- `git diff --check` and `git diff --cached --check`: passed.

No development database or existing Compose volumes were used. New remote CI status
must be checked for this portability commit; the local results do not establish it.

## Finding #5: API contracts and current dashboard loads — 2026-10-12

Inspected actual populated HTTP responses from a new isolated PostgreSQL container
before changing the implementation. Existing wrappers, field names, zero/null values,
DK1/DK2 ordering, run fields and ISO timestamp offset spelling are retained. Response
models now validate these types and publish them in OpenAPI. Pydantic 2 is declared
explicitly; it was already installed and pinned in the unchanged dependency lock.

Local verification with Python 3.11.17, PostgreSQL 17.11 and Docker Engine 29.8.2:

- `python -m pytest -q -p no:cacheprovider`: **72 passed, 1 warning in 3.63s**.
- `python -m pytest -q -p no:cacheprovider tests/test_integration.py`:
  **21 passed, 1 warning in 3.60s**.
- `node --test tests/dashboard.test.cjs`: **13 passed, 0 failed** on local Node
  26.11.1 and the CI-compatible Node 22.23.3 container.
- `ruff check --no-cache .`: **All checks passed**.
- `node --check src/grid_report/static/app.js` and `git diff --check`: passed.
- OpenAPI inspected: required fields, nullable numbers, date/date-time formats, UUIDs
  and run statuses are exposed correctly.
- `bash scripts/smoke_compose.sh`: **exit 0**. Image builds, PostgreSQL/schema health,
  empty report/series/run responses, packaged CSS/JS/fonts, Dagster definitions and
  the running code location passed. Its scoped containers, network and three volumes
  were removed; subsequent listings for that exact project were empty.
  A second run after declaring the existing Pydantic dependency explicitly also exited
  0 and removed its disposable containers, network and volumes successfully.

The first smoke attempt stopped before creating a Compose project because the Windows
checkout has CRLF shell-script endings. The successful run used a temporary Linux copy
with only that script normalized to LF inside a disposable Docker CLI helper. The tracked
script was unchanged. Tests used a read-only checkout mount, disabled bytecode/pytest
cache writes, and only the fresh `gridscope-audit5-db` container's isolated `grid_test`
database with `GRID_TEST_DATABASE=1`, no published ports and its own anonymous volume.
No development databases or existing Compose volumes were used. The warning is the
existing Starlette/httpx TestClient deprecation.

PostgreSQL tests cover populated response values and exact fields, chronological
five-minute instants across normal/spring/autumn days, offset-aware timestamps,
zero-only versus absent summaries, run statuses/nulls, newest-first history and its
20-run limit. They also verify the endpoints leave observations and history unchanged.
Dashboard tests run the actual shipped script with a small DOM fixture and controlled
HTTP promises: stale responses/errors, cancellation, immediate clearing on date edits,
HTTP/network/JSON failures, recovery, populated/empty rendering, SVG gaps and zero
values. Six fixed instants cover DST, Copenhagen/UTC date differences, year boundaries
and leap days. No npm dependencies were added; CI now runs these tests with Node 22.

Separate API calls still read independent database snapshots. The request ID and abort
controller prevent superseded browser loads from rendering; they do not provide
cross-endpoint transactional consistency. DOM fixtures do not test browser layout,
native date-input behavior or network cancellation implementation. No browser visual
checks were rerun; HTML, fonts, SVG presentation and CSS were not redesigned. No live
source polling, ingestion changes or schedule activation were introduced.

GitHub Actions for the preceding ingestion commit `ecc54f1` is now verified:
[run 38233265942](https://github.com/misaelucas/gridscope/actions/runs/38233265942)
completed successfully, with both `test` and `compose-smoke` jobs successful. This
supersedes the earlier observation that no run had appeared yet. Remote CI for finding
#5 is separate and was not established by these local checks; consult the new PR checks.

## Finding #4: PostgreSQL serialization and atomicity — 2026-10-12

Verified with Python 3.11.17, PostgreSQL 17.11 and Docker Engine 29.8.2. A newly
created `gridscope-audit4-db` container used its own anonymous data volume, an isolated
`gridscope-audit4-test` network and no published ports. Only its `grid_test` database
was used with `GRID_TEST_DATABASE=1`. The checkout was mounted read-only for tests,
with `PYTHONPATH=/workspace/src`; pytest caching and bytecode writes were disabled.
No development database, existing Compose volumes or live source data were used.

- `python -m pytest -q -p no:cacheprovider`: **67 passed, 1 warning in 3.02s**.
- `python -m pytest -q -p no:cacheprovider tests/test_integration.py`:
  **16 passed, 1 warning in 2.85s**.
- `ruff check --no-cache .`: **All checks passed**.
- `git diff --check`: passed.
- The repository Dockerfile built successfully for the test runtime. The full Compose
  smoke script was not rerun for this change; earlier successful runs are recorded below.

The warning is the existing Starlette/httpx TestClient deprecation. New integration
coverage proves same-day imports wait on PostgreSQL advisory locks, different-day
imports complete while another date remains locked, incomplete replays retain omitted
rows and aggregates remain correct. SQL trigger failures occur after actual observation
writes and during success-status updates. A nontransactional sequence proves writes
occurred; full row snapshots verify rollback including run IDs and update timestamps.
Failure history commits separately. If that update also fails, the original exception
is preserved with a note and the recording exception/run ID are logged. A fresh-schema
test verifies two concurrent initializers wait on the separate initialization lock and
both complete. Concurrency checks use events, server lock inspection, bounded futures
and test-only statement timeouts, without sleep-based races.

Advisory locks serialize cooperating database writers, not upstream source revisions.
A slower fetch can still overwrite newer values. Direct writers/external DDL can bypass
the protocol. Production lock waits have no configured timeout or automatic database
retry. Abandoned runs, failure-history outages and ambiguous commits after connection
loss still need reconciliation; raw archives are not transactional. Initialization
locking is not a migration mechanism. No API/dashboard contract changes were made.

Remote GitHub Actions for this change had not run at the time of local verification;
local success does not establish remote CI success.

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
