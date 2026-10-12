"""Step 6: a read-only API serves stored data, never polls the upstream per visitor."""
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from grid_report import db

app = FastAPI(title="Grid Report", version="0.1.0")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def dashboard():
    return FileResponse(STATIC / "index.html")


@app.get("/health")
def health():
    with db.connect() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


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
