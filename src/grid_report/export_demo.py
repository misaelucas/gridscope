"""Export a public historical demo from read-only API responses; never export runs."""
import argparse
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
from math import isclose, isfinite
from pathlib import Path

import httpx

from grid_report.api import DailyReport, DailySeries
from grid_report.domain import day_bounds

LIMITATIONS = [
    "Historical observations, not a live feed or a freshness guarantee.",
    "Preliminary Energinet estimates; upstream errors may remain uncorrected.",
    "Carbon intensity in g CO2/kWh is not total CO2 emissions; daily means are not consumption-weighted.",
    "Missing observations remain null. Stored data may accumulate across imports.",
    "API endpoints are read independently; this export checks report/series agreement, not a shared snapshot.",
]


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       indent=2) + "\n").encode("utf-8")


def validate_day(day: date, report: DailyReport, series: list[DailySeries]):
    """Reject incomplete timelines or summaries inconsistent with their actual readings."""
    if report.day != day or [r.area for r in report.regions] != ["DK1", "DK2"]:
        raise ValueError("Report day or region order mismatch")
    start, end = day_bounds(day)
    expected = [start + timedelta(minutes=5 * i) for i in range(int((end-start).total_seconds()/300))]
    for region, readings in zip(report.regions, series, strict=True):
        if readings.day != day or readings.area != region.area:
            raise ValueError("Series day or area mismatch")
        if [o.timestamp for o in readings.observations] != expected:
            raise ValueError("Series must contain the complete chronological five-minute timeline")
        values = [o.intensity for o in readings.observations if o.intensity is not None]
        if any(not isfinite(v) or v < 0 for v in values):
            raise ValueError("Invalid intensity")
        if (region.expected_intervals != len(expected) or region.observed_intervals != len(values)
                or region.missing_intervals != len(expected)-len(values)
                or not isclose(region.completeness_percent, round(100*len(values)/len(expected), 2))):
            raise ValueError("Report completeness disagrees with series")
        for actual, calculated in [(region.average_g_per_kwh, sum(values)/len(values) if values else None),
                                   (region.minimum_g_per_kwh, min(values) if values else None),
                                   (region.peak_g_per_kwh, max(values) if values else None)]:
            if (actual is None) != (calculated is None) or (
                    actual is not None and not isclose(actual, calculated, rel_tol=1e-9, abs_tol=1e-9)):
                raise ValueError("Report aggregate disagrees with series")
        latest = next((o.timestamp for o in reversed(readings.observations)
                       if o.intensity is not None), None)
        if region.latest_observation != latest:
            raise ValueError("Report latest observation disagrees with series")


def export_demo(client: httpx.Client, days: list[date], output: Path,
                exported_at: datetime | None = None):
    payloads = {}
    for day in sorted(set(days)):
        def get(path, **params):
            response = client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        report = DailyReport.model_validate(get("/api/reports", day=day.isoformat()))
        series = [DailySeries.model_validate(get("/api/series", day=day.isoformat(), area=area))
                  for area in ["DK1", "DK2"]]
        validate_day(day, report, series)
        # Whitelist through models, then strip operational ingestion timestamps.
        for region in report.regions:
            region.last_ingested_at = None
        payloads[day.isoformat()] = encoded({"report": report.model_dump(mode="json"),
                                            "series": [s.model_dump(mode="json") for s in series]})
    if not payloads:
        raise ValueError("At least one date is required")
    revision = sha256(b"".join(payloads.values())).hexdigest()[:16]
    manifest = {"schema_version": 1, "revision": revision, "dates": list(payloads),
                "source": "Energinet / CO2Emis", "unit": "g CO2/kWh",
                "timezone": "Europe/Copenhagen",
                "source_url": "https://www.energidataservice.dk/tso-electricity/co2emis",
                "exported_at": (exported_at or datetime.now(timezone.utc)).isoformat(),
                "limitations": LIMITATIONS}
    # Validate every response before writing. Publish the manifest last, atomically.
    destination = output / "v1" / revision
    destination.mkdir(parents=True, exist_ok=True)
    for day, payload in payloads.items():
        (destination / f"{day}.json").write_bytes(payload)
    manifest_path = output / "v1" / "manifest.json"
    temporary = manifest_path.with_suffix(".tmp")
    temporary.write_bytes(encoded(manifest))
    temporary.replace(manifest_path)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--day", type=date.fromisoformat, action="append", required=True)
    parser.add_argument("--output", type=Path, default=Path("frontend/demo"))
    args = parser.parse_args()
    # Never include this URL, exceptions, credentials or run history in exported JSON.
    with httpx.Client(base_url=args.api_url, timeout=30) as client:
        manifest = export_demo(client, args.day, args.output)
    print(f"Exported {len(manifest['dates'])} day(s), revision {manifest['revision']}")


if __name__ == "__main__":
    main()
