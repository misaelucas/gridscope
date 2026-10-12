"""Real PostgreSQL tests; use an isolated database (tables are cleared per test)."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event
from time import monotonic
from uuid import uuid4

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from grid_report import db
from grid_report.api import app
from grid_report.pipeline import ingest_day

pytestmark = pytest.mark.skipif(os.getenv("GRID_TEST_DATABASE") != "1",
                                reason="Set GRID_TEST_DATABASE=1 with an isolated PostgreSQL DB")
DAY = date(2026, 10, 10)


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr("grid_report.pipeline.RAW_DIR", tmp_path)
    db.init_db()
    with db.connect() as conn:
        conn.execute("TRUNCATE observations, ingestion_runs")


def client_for(value=100, timestamp="2026-10-09T22:00:00"):
    return httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={
        "records": [{"Minutes5UTC": timestamp, "PriceArea": "DK1", "CO2Emission": value}]})))


def test_replay_revision_and_gaps():
    with client_for() as client:
        ingest_day(DAY, client)
        ingest_day(DAY, client)
    with client_for(50) as client:
        ingest_day(DAY, client)
    result = db.report(DAY)
    assert result[0]["observed_intervals"] == 1
    assert result[0]["average_g_per_kwh"] == 50
    assert result[0]["missing_intervals"] == 287
    assert result[1]["average_g_per_kwh"] is None
    assert len(db.series(DAY, "DK1")) == 288
    assert len(db.runs()) == 3


def test_invalid_import_preserves_good_data_and_records_failure():
    with client_for() as client:
        ingest_day(DAY, client)
    with client_for(-1) as client, pytest.raises(ValueError):
        ingest_day(DAY, client)
    assert db.report(DAY)[0]["average_g_per_kwh"] == 100
    assert db.runs()[0]["status"] == "failed"


def test_wrong_day_is_rejected():
    with client_for(timestamp="2026-10-10T22:00:00") as client, pytest.raises(ValueError):
        ingest_day(DAY, client)
    assert db.report(DAY)[0]["observed_intervals"] == 0


@pytest.mark.parametrize("day,expected", [("2026-03-29", 276), ("2026-10-25", 300)])
def test_sql_dst_and_api(day, expected):
    response = TestClient(app).get("/api/reports", params={"day": day})
    assert response.status_code == 200
    assert response.json()["regions"][0]["expected_intervals"] == expected
    assert len(db.series(date.fromisoformat(day), "DK1")) == expected


def test_api_validation():
    client = TestClient(app)
    assert client.get("/api/series?day=2026-10-10&area=oops").status_code == 422
    assert client.get("/api/reports?day=bad").status_code == 422
    assert client.get("/").status_code == 200


def test_health_with_initialized_database():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "schema": "ready"}


def test_valid_first_row_invalid_second_row_never_partially_writes():
    records = [
        {"Minutes5UTC": "2026-10-09T22:00:00", "PriceArea": "DK1", "CO2Emission": 80},
        {"Minutes5UTC": "2026-10-09T22:05:00", "PriceArea": "DK1", "CO2Emission": None},
    ]
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"records": records})
    )) as client, pytest.raises(ValueError):
        ingest_day(DAY, client)
    assert db.report(DAY)[0]["observed_intervals"] == 0
    assert db.runs()[0]["status"] == "failed"


def test_dagster_marks_partial_day_as_failed_quality_check(monkeypatch):
    from dagster import DagsterInstance
    from grid_report.definitions import defs

    monkeypatch.setattr("grid_report.pipeline.fetch_day", lambda *args: [
        {"Minutes5UTC": "2026-10-09T22:00:00", "PriceArea": "DK1", "CO2Emission": 80}
    ])
    with DagsterInstance.ephemeral() as instance:
        result = defs.resolve_job_def("daily_carbon_report").execute_in_process(
            partition_key=DAY.isoformat(), instance=instance
        )
    assert result.success  # Import succeeded, but completeness is a separate result.
    checks = result.get_asset_check_evaluations()
    assert len(checks) == 1
    assert checks[0].passed is False


def records_for(day=DAY, values=(10, 30)):
    from datetime import timedelta
    from grid_report.domain import day_bounds

    start, _ = day_bounds(day)
    return [{"Minutes5UTC": (start + timedelta(minutes=5 * i)).isoformat(),
             "PriceArea": "DK1", "CO2Emission": value} for i, value in enumerate(values)]


def import_records(day=DAY, values=(10, 30)):
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, json={"records": records_for(day, values)}))) as client:
        return ingest_day(day, client)


def snapshot():
    with db.connect() as conn:
        return conn.execute("SELECT * FROM observations ORDER BY observed_at, area").fetchall()


def test_incomplete_replay_retains_rows_and_correct_aggregates():
    import_records(values=(0, 30, 60))
    import_records(values=(90,))
    report = db.report(DAY)[0]
    assert report["observed_intervals"] == 3
    assert report["missing_intervals"] == 285
    assert report["completeness_percent"] == 1.04
    assert report["average_g_per_kwh"] == 60
    assert report["minimum_g_per_kwh"] == 30
    assert report["peak_g_per_kwh"] == 90
    assert [r["intensity"] for r in db.series(DAY, "DK1")[:3]] == [90, 30, 60]


@pytest.mark.parametrize("failure", ["observation", "success", "failure_history"])
def test_sql_failure_rolls_back_written_rows_and_preserves_original(failure, caplog):
    import_records()
    before = snapshot()
    # Sequence increments survive rollback: evidence that SQL actually wrote rows.
    with db.connect() as conn:
        conn.execute("CREATE SEQUENCE audit_writes")
        conn.execute("""CREATE FUNCTION audit_observation() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM nextval('audit_writes');
                IF NEW.intensity = 999 THEN RAISE EXCEPTION 'injected observation failure'; END IF;
                RETURN NEW;
            END $$""")
        conn.execute("""CREATE TRIGGER audit_observation AFTER INSERT OR UPDATE ON observations
                        FOR EACH ROW EXECUTE FUNCTION audit_observation()""")
        conn.execute("""CREATE FUNCTION audit_status() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.status = 'success' THEN RAISE EXCEPTION 'injected success failure'; END IF;
                IF NEW.status = 'failed' AND TG_ARGV[0] = 'failure_history' THEN
                    RAISE EXCEPTION 'injected history failure';
                END IF;
                RETURN NEW;
            END $$""")
        if failure != "observation":
            conn.execute("""CREATE TRIGGER audit_status BEFORE UPDATE ON ingestion_runs
                            FOR EACH ROW EXECUTE FUNCTION audit_status(%s)""" % (
                                "'failure_history'" if failure == "failure_history" else "'success'"))
    try:
        values = (80, 40, 999) if failure == "observation" else (80, 40, 20)
        with pytest.raises(psycopg.errors.RaiseException) as caught:
            import_records(values=values)
        expected = "observation" if failure == "observation" else "success"
        assert f"injected {expected} failure" in str(caught.value)
        assert snapshot() == before  # Includes provenance and update timestamps.
        with db.connect() as conn:
            assert conn.execute("SELECT last_value FROM audit_writes").fetchone()["last_value"] == 3
        run = db.runs()[0]
        if failure == "failure_history":
            assert run["status"] == "running"
            assert "Failure history could not be recorded" in caught.value.__notes__[0]
            assert str(run["id"]) in caplog.text
            assert "injected history failure" in caplog.text
        else:
            assert run["status"] == "failed"
            assert run["finished_at"] is not None
            assert run["received"] is None
            assert f"injected {expected} failure" in run["error"]
    finally:
        with db.connect() as conn:
            conn.execute("DROP TRIGGER IF EXISTS audit_status ON ingestion_runs")
            conn.execute("DROP TRIGGER audit_observation ON observations")
            conn.execute("DROP FUNCTION audit_status(), audit_observation()")
            conn.execute("DROP SEQUENCE audit_writes")


@pytest.mark.parametrize("same_day", [True, False])
def test_concurrent_imports_serialize_only_same_day(monkeypatch, same_day):
    first_locked, release, second_attempt = Event(), Event(), Event()
    original_lock = db.lock_day
    pids = []

    def controlled_lock(conn, day):
        conn.execute("SET statement_timeout = '5s'")
        pids.append(conn.info.backend_pid)
        if len(pids) == 1:
            original_lock(conn, day)
            first_locked.set()
            assert release.wait(5), "first writer was not released"
        else:
            second_attempt.set()
            original_lock(conn, day)

    monkeypatch.setattr(db, "lock_day", controlled_lock)
    other_day = DAY if same_day else date(2026, 10, 11)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(import_records, DAY, (10, 30))
        try:
            assert first_locked.wait(5)
            second = pool.submit(import_records, other_day, (50, 70))
            assert second_attempt.wait(5)
            if same_day:
                # Observe the real server wait, not an assumed scheduling delay.
                deadline = monotonic() + 5
                with db.connect() as conn:
                    conn.execute("SET statement_timeout = '5s'")
                    while monotonic() < deadline:
                        waiting = conn.execute("""SELECT count(*) AS n FROM pg_locks
                            WHERE pid=%s AND locktype='advisory' AND NOT granted""",
                            (pids[1],)).fetchone()["n"]
                        if waiting:
                            break
                    else:
                        pytest.fail("second writer never waited on the day lock")
                assert not second.done()
                assert snapshot() == []
                assert all(r["status"] == "running" for r in db.runs())
            else:
                second.result(timeout=5)  # Completes while first still holds its lock.
                assert not first.done()
                assert db.report(other_day)[0]["average_g_per_kwh"] == 60
        finally:
            release.set()
        first.result(timeout=5)
        second.result(timeout=5)
    assert db.report(DAY)[0]["average_g_per_kwh"] == (60 if same_day else 20)
    assert all(r["status"] == "success" for r in db.runs())


def test_concurrent_first_schema_initialization(monkeypatch):
    from contextlib import contextmanager

    schema = "audit_" + uuid4().hex
    original_connect = db.connect
    with original_connect() as conn:
        conn.execute(psycopg.sql.SQL("CREATE SCHEMA {}").format(psycopg.sql.Identifier(schema)))

    @contextmanager
    def scoped_connect():
        with original_connect() as conn:
            conn.execute("SET statement_timeout = '5s'")
            conn.execute(psycopg.sql.SQL("SET search_path TO {}").format(
                psycopg.sql.Identifier(schema)))
            yield conn

    monkeypatch.setattr(db, "connect", scoped_connect)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            with original_connect() as blocker:
                blocker.execute("SELECT pg_advisory_xact_lock(%s, 0)", (db.LOCK_NAMESPACE,))
                futures = [pool.submit(db.init_db) for _ in range(2)]
                deadline = monotonic() + 5
                with original_connect() as monitor:
                    monitor.execute("SET statement_timeout = '5s'")
                    while monotonic() < deadline:
                        count = monitor.execute("""SELECT count(*) AS n FROM pg_locks
                            WHERE locktype='advisory' AND classid=%s AND objid=0
                            AND objsubid=2 AND NOT granted""",
                            (db.LOCK_NAMESPACE,)).fetchone()["n"]
                        if count == 2:
                            break
                    else:
                        pytest.fail("both initializers must wait on the schema lock")
            for future in futures:
                future.result(timeout=5)
        with scoped_connect() as conn:
            conn.execute("SELECT observed_at, area, intensity, run_id FROM observations LIMIT 0")
            conn.execute("SELECT status, received FROM ingestion_runs LIMIT 0")
    finally:
        with original_connect() as conn:
            conn.execute(psycopg.sql.SQL("DROP SCHEMA {} CASCADE").format(
                psycopg.sql.Identifier(schema)))
