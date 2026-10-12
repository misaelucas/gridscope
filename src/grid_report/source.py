"""Step 2: fetch bounded pages; archive responses before interpreting them."""
import json
import time
from datetime import date, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

from grid_report.config import SOURCE_URL

MAX_RETRY_DELAY = 30
MAX_RETRY_WAIT = 60  # Shared by all pages in one fetch_day call.


def retry_delay(header: str, attempt: int) -> float:
    """Honor delta-seconds or HTTP dates, within a fixed delay ceiling."""
    fallback = 2 ** attempt
    header = header.strip()
    if header.isascii() and header.isdigit():
        # Avoid converting arbitrarily large integers supplied by a server.
        requested = MAX_RETRY_DELAY if len(header) > 10 else int(header)
    else:
        try:
            instant = parsedate_to_datetime(header)
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=timezone.utc)
            requested = max(0, instant.timestamp() - time.time())
        except (ValueError, TypeError, OverflowError):
            requested = 0
    return min(MAX_RETRY_DELAY, max(fallback, requested))


def fetch_day(day: date, archive: Path, client: httpx.Client, page_size: int = 1000) -> list:
    archive.mkdir(parents=True, exist_ok=True)
    records = []
    waited = 0.0
    # API filters use DANISH LOCAL dates. Do not pass our UTC midnight bounds here.
    params = {"start": day.isoformat(), "end": (day + timedelta(days=1)).isoformat(),
              "sort": "Minutes5UTC ASC,PriceArea ASC", "limit": page_size}
    for page in range(20):  # A hard bound protects against a broken pagination contract.
        params["offset"] = page * page_size
        for attempt in range(4):
            try:
                response = client.get(SOURCE_URL, params=params)
                response.raise_for_status()
                break
            except (httpx.TransportError, httpx.HTTPStatusError) as error:
                # Allowlist diagnostic fields: error bodies/headers can echo credentials.
                diagnostic = {"page": page, "attempt": attempt + 1}
                if isinstance(error, httpx.HTTPStatusError):
                    diagnostic["status_code"] = error.response.status_code
                else:
                    diagnostic["transport_failure"] = True
                (archive / f"failure-{page:03}-{attempt + 1}.json").write_text(
                    json.dumps(diagnostic)
                )
                retryable = not isinstance(error, httpx.HTTPStatusError) or (
                    error.response.status_code == 429 or error.response.status_code >= 500)
                if not retryable or attempt == 3 or waited >= MAX_RETRY_WAIT:
                    raise
                header = (error.response.headers.get("Retry-After", "")
                          if isinstance(error, httpx.HTTPStatusError) else "")
                delay = min(retry_delay(header, attempt), MAX_RETRY_WAIT - waited)
                time.sleep(delay)
                waited += delay
        # Keep exact response bytes: this is evidence for debugging upstream changes.
        (archive / f"page-{page:03}.json").write_bytes(response.content)
        payload = json.loads(response.content)
        if not isinstance(payload, dict) or "records" not in payload:
            raise ValueError("Source payload must be an object containing records")
        batch = payload["records"]
        if not isinstance(batch, list):
            raise ValueError("Source records must be a list")
        records.extend(batch)
        if len(batch) < page_size:
            return records
    raise RuntimeError("Pagination exceeded safety bound")
