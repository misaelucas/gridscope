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


def test_no_retry_for_bad_request(tmp_path, sleeps):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(400)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_day(date(2026, 10, 10), tmp_path, client)
    assert len(calls) == 1
    assert sleeps == []


@pytest.fixture
def sleeps(monkeypatch):
    waits = []
    monkeypatch.setattr("grid_report.source.time.sleep", waits.append)
    return waits


@pytest.mark.parametrize("status", [429, 503])
def test_retry_after_and_safe_diagnostics(tmp_path, sleeps, status):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(status, text="secret-body", headers={
                "Retry-After": "3", "Set-Cookie": "secret-cookie"})
        return httpx.Response(200, content=b'{"records": []}')

    with httpx.Client(transport=httpx.MockTransport(handler), headers={
        "Authorization": "Bearer secret-token", "X-API-Key": "secret-key"
    }) as client:
        assert fetch_day(date(2026, 10, 10), tmp_path, client) == []
    assert sleeps == [3]
    assert json.loads((tmp_path / "failure-000-1.json").read_text()) == {
        "page": 0, "attempt": 1, "status_code": status}
    assert (tmp_path / "page-000.json").read_bytes() == b'{"records": []}'
    assert all(b"secret" not in path.read_bytes() for path in tmp_path.iterdir())


@pytest.mark.parametrize("header,expected", [
    (None, 1), ("", 1), ("invalid", 1), ("-10", 1), ("1.5", 1),
    ("999999999999999999999999999999999", 30), (" 5 ", 5),
    ("Wed, 21 Oct 2015 07:28:10 GMT", 10),
    ("Wed, 21 Oct 2015 07:27:00 GMT", 1),
    ("Wed, 21 Oct 2099 07:28:00 GMT", 30),
])
def test_retry_after_formats(tmp_path, sleeps, monkeypatch, header, expected):
    from datetime import datetime
    monkeypatch.setattr("grid_report.source.time.time", lambda: datetime.fromisoformat(
        "2015-10-21T07:28:00+00:00").timestamp())
    calls = []

    def handler(request):
        calls.append(request)
        headers = {} if header is None else {"Retry-After": header}
        return httpx.Response(429, headers=headers) if len(calls) == 1 else httpx.Response(
            200, json={"records": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        fetch_day(date(2026, 10, 10), tmp_path, client)
    assert sleeps == [expected]


@pytest.mark.parametrize("failure", [429, 503, "transport"])
def test_retry_exhaustion(tmp_path, sleeps, failure):
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "transport":
            raise httpx.ConnectError("secret-transport-message", request=request)
        return httpx.Response(failure)

    exception = httpx.TransportError if failure == "transport" else httpx.HTTPStatusError
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(exception):
            fetch_day(date(2026, 10, 10), tmp_path, client)
    assert len(calls) == 4
    assert sleeps == [1, 2, 4]
    assert len(list(tmp_path.glob("failure-*.json"))) == 4
    assert all(b"secret" not in path.read_bytes() for path in tmp_path.iterdir())


def test_transport_failure_recovers(tmp_path, sleeps):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("timeout", request=request)
        return httpx.Response(200, json={"records": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_day(date(2026, 10, 10), tmp_path, client) == []
    assert sleeps == [1]
    assert len(calls) == 2


@pytest.mark.parametrize("header,expected_waits", [("99999", [30, 30]), ("25", [25, 25, 10])])
def test_wait_budget_is_shared_across_pages(tmp_path, sleeps, header, expected_waits):
    calls = []

    def handler(request):
        offset = int(request.url.params["offset"])
        calls.append(offset)
        if calls.count(offset) == 1:
            return httpx.Response(503, headers={"Retry-After": header})
        return httpx.Response(200, json={"records": [{}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_day(date(2026, 10, 10), tmp_path, client, page_size=1)
    assert sleeps == expected_waits
    successful_pages = len(expected_waits)
    assert calls == [offset for offset in range(successful_pages) for _ in range(2)] + [
        successful_pages]


@pytest.mark.parametrize("content", [b"not json", b"[]", b"null", b"{}",
                                    b'{"records": null}', b'{"records": {}}'])
def test_malformed_payload_is_archived_without_retry(tmp_path, sleeps, content):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=content)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError):
            fetch_day(date(2026, 10, 10), tmp_path, client)
    assert len(calls) == 1
    assert sleeps == []
    assert (tmp_path / "page-000.json").read_bytes() == content


def test_pagination_limit(tmp_path, sleeps):
    offsets = []

    def handler(request):
        offsets.append(int(request.url.params["offset"]))
        return httpx.Response(200, json={"records": [{}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RuntimeError, match="Pagination exceeded safety bound"):
            fetch_day(date(2026, 10, 10), tmp_path, client, page_size=1)
    assert offsets == list(range(20))
    assert len(list(tmp_path.glob("page-*.json"))) == 20
    assert sleeps == []
