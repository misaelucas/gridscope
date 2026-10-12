"""Step 6: a read-only API serves stored data, never polls the upstream per visitor."""
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import psycopg
from pydantic import AwareDatetime, BaseModel, field_serializer

from grid_report import db

Area = Literal["DK1", "DK2"]


class APIResponse(BaseModel):
    @field_serializer("*", when_used="json")
    def serialize_timestamp(self, value):
        # Keep the existing ISO offset spelling instead of changing UTC to Z.
        return value.isoformat() if isinstance(value, datetime) else value


class RegionReport(APIResponse):
    area: Area
    observed_intervals: int
    expected_intervals: int
    missing_intervals: int
    completeness_percent: float
    average_g_per_kwh: float | None
    peak_g_per_kwh: float | None
    minimum_g_per_kwh: float | None
    latest_observation: AwareDatetime | None
    last_ingested_at: AwareDatetime | None


class DailyReport(APIResponse):
    day: date
    timezone: Literal["Europe/Copenhagen"]
    source: Literal["Energinet / CO2Emis"]
    unit: Literal["g CO2/kWh"]
    regions: list[RegionReport]


class SeriesObservation(APIResponse):
    timestamp: AwareDatetime
    intensity: float | None


class DailySeries(APIResponse):
    day: date
    area: Area
    observations: list[SeriesObservation]


class IngestionRun(APIResponse):
    id: UUID
    report_day: date
    started_at: AwareDatetime
    finished_at: AwareDatetime | None
    status: Literal["running", "success", "failed"]
    received: int | None
    error: str | None
    archive_path: str


app = FastAPI(title="GridScope", version="0.1.0")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def dashboard():
    index = STATIC / "spa" / "index.html"
    if not index.is_file():
        return JSONResponse(status_code=503, content={
            "detail": "Frontend build missing. Run npm ci and npm run build in frontend/."})
    return FileResponse(index)


@app.get("/health")
def health():
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1")
            # Validate the columns used by reporting without scanning table data.
            conn.execute("""SELECT observed_at, area, intensity, run_id, updated_at
                            FROM observations LIMIT 0""")
            conn.execute("""SELECT id, report_day, started_at, finished_at, status,
                            received, error, archive_path FROM ingestion_runs LIMIT 0""")
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return JSONResponse(status_code=503, content={
            "status": "unavailable", "database": "ok", "schema": "not_ready"})
    except psycopg.Error:
        return JSONResponse(status_code=503, content={
            "status": "unavailable", "database": "unavailable", "schema": "unknown"})
    return {"status": "ok", "database": "ok", "schema": "ready"}


@app.get("/api/reports", response_model=DailyReport)
def daily_report(day: date):
    return {"day": day, "timezone": "Europe/Copenhagen", "source": "Energinet / CO2Emis",
            "unit": "g CO2/kWh", "regions": db.report(day)}


@app.get("/api/series", response_model=DailySeries)
def observations(day: date, area: Area = "DK1"):
    return {"day": day, "area": area, "observations": db.series(day, area)}


@app.get("/api/runs", response_model=list[IngestionRun])
def ingestion_runs():
    return db.runs()
