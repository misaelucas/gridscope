"""Step 4: coordinate extraction, validation, and one atomic database update."""
from datetime import date
import logging
from uuid import uuid4

import httpx

from grid_report import db
from grid_report.config import RAW_DIR
from grid_report.domain import day_bounds, normalize
from grid_report.source import fetch_day

logger = logging.getLogger(__name__)


def ingest_day(day: date, client: httpx.Client | None = None) -> dict:
    run_id = uuid4()
    archive = RAW_DIR / day.isoformat() / str(run_id)
    with db.connect() as conn:
        conn.execute("""INSERT INTO ingestion_runs(id, report_day, status, archive_path)
                        VALUES (%s, %s, 'running', %s)""", (run_id, day, str(archive)))
    try:
        if client is None:
            with httpx.Client(timeout=30) as owned_client:
                records = fetch_day(day, archive, owned_client)
        else:
            records = fetch_day(day, archive, client)
        observations = [normalize(record) for record in records]
        start, end = day_bounds(day)
        keys = {(o.timestamp, o.area) for o in observations}
        if len(keys) != len(observations):
            raise ValueError("Duplicate source keys; refusing ambiguous input")
        if any(not start <= o.timestamp < end for o in observations):
            raise ValueError("Source returned observations outside requested local day")
        # Validate EVERYTHING first. A bad page must not partially replace good data.
        with db.connect() as conn:
            # Fetching is finished; the lock protects writes and success status together.
            # Lock acquisition order does not establish source revision freshness.
            db.lock_day(conn, day)
            with conn.cursor() as cur:
                cur.executemany("""
                    INSERT INTO observations(observed_at, area, intensity, run_id)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (observed_at, area) DO UPDATE
                    SET intensity = EXCLUDED.intensity, run_id = EXCLUDED.run_id, updated_at = now()
                """, [(o.timestamp, o.area, o.intensity, run_id) for o in observations])
            conn.execute("""UPDATE ingestion_runs SET status='success', finished_at=now(),
                            received=%s WHERE id=%s""", (len(observations), run_id))
        return {"run_id": str(run_id), "day": str(day), "received": len(observations)}
    except Exception as error:
        # This separate transaction survives the rollback of the observation transaction.
        try:
            with db.connect() as conn:
                conn.execute("""UPDATE ingestion_runs SET status='failed', finished_at=now(),
                                error=%s WHERE id=%s""", (str(error)[:2000], run_id))
        except Exception as recording_error:
            error.add_note(f"Failure history could not be recorded for run {run_id}: "
                           f"{type(recording_error).__name__}")
            logger.exception("Could not record ingestion failure for run %s", run_id)
        raise
