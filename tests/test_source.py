import json
from datetime import date

import httpx
import pytest

from grid_report.source import fetch_day


def test_pagination_uses_local_dates_and_archives(tmp_path):
    offsets = []
    def handler(request):
        assert request.url.params["start"] == "2026-10-10"
        offsets.append(int(request.url.params["offset"]))
        records = [{"test": 1}] if len(offsets) == 1 else []
        return httpx.Response(200, json={"records": records})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert len(fetch_day(date(2026, 10, 10), tmp_path, client, page_size=1)) == 1
    assert offsets == [0, 1]
    assert json.loads((tmp_path / "page-000.json").read_text())["records"]


def test_retry_transient_failure(tmp_path, monkeypatch):
    monkeypatch.setattr("grid_report.source.time.sleep", lambda _: None)
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(503 if len(calls) == 1 else 200, json={"records": []})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_day(date(2026, 10, 10), tmp_path, client) == []
    assert len(calls) == 2


def test_no_retry_for_bad_request(tmp_path):
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(400))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_day(date(2026, 10, 10), tmp_path, client)
