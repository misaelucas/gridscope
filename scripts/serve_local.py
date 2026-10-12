"""Optional Docker-free demo: pip install -e '.[dev]' pgserver.

Starts bundled PostgreSQL in data/postgres and serves the API on localhost:8017.
The server is stopped when this process exits; data remains on disk.
"""
import os
from pathlib import Path

import pgserver
import uvicorn

# Configure BEFORE importing grid_report modules (settings are loaded on import).
root = Path(__file__).resolve().parents[1]
os.chdir(root)
(root / 'data').mkdir(exist_ok=True)
server = pgserver.get_server(root / 'data' / 'postgres')
os.environ['DATABASE_URL'] = server.get_uri()
(root / 'data' / 'local-db-url').write_text(server.get_uri())
(root / 'data' / 'local-db-url').chmod(0o600)

from grid_report.db import init_db  # noqa: E402

init_db()
print('Local database ready. In another terminal:')
print('export DATABASE_URL="$(cat data/local-db-url)"')
print('grid-report ingest --start 2026-10-10 --end 2026-10-11')
uvicorn.run('grid_report.api:app', host='127.0.0.1', port=8017)
