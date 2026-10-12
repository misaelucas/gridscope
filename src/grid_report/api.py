"""Step 6: a read-only API serves stored data, never polls the upstream per visitor."""
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import psycopg

from grid_report import db

app = FastAPI(title="GridScope", version="0.1.0")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def dashboard():
    return FileResponse(STATIC / "index.html")


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


@app.get("/api/reports")
def daily_report(day: date):
    return {"day": day, "timezone": "Europe/Copenhagen", "source": "Energinet / CO2Emis",
            "unit": "g CO2/kWh", "regions": db.report(day)}


@app.get("/api/series")
def observations(day: date, area: Literal["DK1", "DK2"] = "DK1"):
    return {"day": day, "area": area, "observations": db.series(day, area)}


@app.get("/api/runs")
def ingestion_runs():
    return db.runs()
