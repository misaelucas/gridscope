"""Real PostgreSQL tests; use an isolated database (tables are cleared per test)."""
import os
from datetime import date

import httpx
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
