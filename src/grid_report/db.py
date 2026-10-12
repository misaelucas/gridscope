"""Step 3: small database functions; all external values are SQL parameters."""
from datetime import date
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from grid_report.config import DATABASE_URL
from grid_report.domain import day_bounds

SQL = Path(__file__).parent / "sql"


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def init_db():
    with connect() as conn:
        conn.execute((SQL / "schema.sql").read_text())


def report(day: date) -> list[dict]:
    start, end = day_bounds(day)
    with connect() as conn:
        return conn.execute((SQL / "report.sql").read_text(),
                            {"start": start, "end": end}).fetchall()


def series(day: date, area: str) -> list[dict]:
    start, end = day_bounds(day)
    with connect() as conn:
        return conn.execute("""
            SELECT s AS timestamp, o.intensity
            FROM generate_series(%s::timestamptz, %s::timestamptz - interval '5 minutes',
                                 interval '5 minutes') s
            LEFT JOIN observations o ON o.observed_at = s AND o.area = %s
            ORDER BY s
        """, (start, end, area)).fetchall()


def runs() -> list[dict]:
    with connect() as conn:
        return conn.execute("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20").fetchall()
