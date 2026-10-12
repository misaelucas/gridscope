"""Exporter fixtures are synthetic test data; never published as demo observations."""
from datetime import date, datetime, timedelta, timezone
import json

import httpx
import pytest

from grid_report.domain import day_bounds
from grid_report.export_demo import export_demo


def fixture(day, area):
    start, end = day_bounds(day)
    count = int((end-start).total_seconds()/300)
    return {"day": str(day), "area": area, "observations": [
        {"timestamp": (start+timedelta(minutes=5*i)).isoformat(),
         "intensity": None if i == 1 else 0.0} for i in range(count)]}


def client_for(day, mutation=None):
    series = [fixture(day, area) for area in ["DK1", "DK2"]]
    count = len(series[0]["observations"])
    report = {"day": str(day), "timezone": "Europe/Copenhagen", "source": "Energinet / CO2Emis",
              "unit": "g CO2/kWh", "regions": [
                  {"area": s["area"], "observed_intervals": count-1, "expected_intervals": count,
                   "missing_intervals": 1, "completeness_percent": round(100*(count-1)/count, 2),
                   "average_g_per_kwh": 0, "minimum_g_per_kwh": 0, "peak_g_per_kwh": 0,
                   "latest_observation": s["observations"][-1]["timestamp"],
                   "last_ingested_at": "2026-10-12T00:00:00Z", "archive_path": "secret/path"}
                  for s in series], "error": "secret operational error"}
    if mutation:
        mutation(report, series)
    requests = []

    def handle(request):
        requests.append(request.url.path)
        body = report if request.url.path == "/api/reports" else series[
            0 if request.url.params["area"] == "DK1" else 1]
        return httpx.Response(200, json=body)
    return httpx.Client(base_url="http://test", transport=httpx.MockTransport(handle)), requests


@pytest.mark.parametrize("day,count", [(date(2026, 3, 29), 276), (date(2026, 10, 9), 288),
                                        (date(2026, 10, 25), 300)])
def test_export_preserves_contract_dst_zero_null_and_sanitizes(tmp_path, day, count):
    with client_for(day)[0] as client:
        manifest = export_demo(client, [day, day], tmp_path,
                               datetime(2026, 10, 12, tzinfo=timezone.utc))
    payload = json.loads((tmp_path/"v1"/manifest["revision"]/f"{day}.json").read_text())
    assert manifest["dates"] == [str(day)]
    assert manifest["exported_at"] == "2026-10-12T00:00:00+00:00"
    assert "not a live feed" in manifest["limitations"][0]
    for series in payload["series"]:
        assert len(series["observations"]) == count
        assert series["observations"][0]["intensity"] == 0
        assert series["observations"][1]["intensity"] is None
    for region in payload["report"]["regions"]:
        assert region["last_ingested_at"] is None
    assert "secret" not in json.dumps(payload)
    assert "archive_path" not in json.dumps(payload)


def test_export_deterministic_read_only_and_manifest_last(tmp_path):
    day = date(2026, 10, 9)
    client, requests = client_for(day)
    with client:
        first = export_demo(client, [day], tmp_path, datetime(2026, 10, 12, tzinfo=timezone.utc))
        original = (tmp_path/"v1"/"manifest.json").read_bytes()
        assert export_demo(client, [day], tmp_path, datetime(2026, 10, 12, tzinfo=timezone.utc)) == first
    assert (tmp_path/"v1"/"manifest.json").read_bytes() == original
    assert "/api/runs" not in requests
    with client_for(day, lambda report, series: report["regions"][0].update(average_g_per_kwh=99))[0] as client:
        with pytest.raises(ValueError, match="aggregate"):
            export_demo(client, [day], tmp_path)
    assert (tmp_path/"v1"/"manifest.json").read_bytes() == original


@pytest.mark.parametrize("mutation", [
    lambda report, series: series[0]["observations"].pop(),
    lambda report, series: series[0]["observations"].reverse(),
    lambda report, series: series[0]["observations"][0].update(intensity=-1),
    lambda report, series: report["regions"][0].update(observed_intervals=1),
    lambda report, series: series[0].update(day="2026-10-10"),
])
def test_invalid_export_writes_nothing(tmp_path, mutation):
    with client_for(date(2026, 10, 9), mutation)[0] as client:
        with pytest.raises(ValueError):
            export_demo(client, [date(2026, 10, 9)], tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_unavailable_api_does_not_create_placeholder_data(tmp_path):
    with httpx.Client(base_url="http://test", transport=httpx.MockTransport(
            lambda request: httpx.Response(503))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            export_demo(client, [date(2026, 10, 9)], tmp_path)
    assert list(tmp_path.iterdir()) == []
