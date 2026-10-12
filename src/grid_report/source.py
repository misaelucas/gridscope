"""Step 2: fetch bounded pages; archive responses before interpreting them."""
import json
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

from grid_report.config import SOURCE_URL


def fetch_day(day: date, archive: Path, client: httpx.Client, page_size: int = 1000) -> list:
    archive.mkdir(parents=True, exist_ok=True)
    records = []
    # API filters use DANISH LOCAL dates. Do not pass our UTC midnight bounds here.
    params = {"start": day.isoformat(), "end": (day + timedelta(days=1)).isoformat(),
              "sort": "Minutes5UTC ASC,PriceArea ASC", "limit": page_size}
    for page in range(20):  # A hard bound protects against a broken pagination contract.
        params["offset"] = page * page_size
        for attempt in range(4):
            try:
                response = client.get(SOURCE_URL, params=params)
                if response.status_code == 429 or response.status_code >= 500:
                    response.raise_for_status()
                response.raise_for_status()
                break
            except (httpx.TransportError, httpx.HTTPStatusError) as error:
                retryable = not isinstance(error, httpx.HTTPStatusError) or (
                    error.response.status_code == 429 or error.response.status_code >= 500)
                if not retryable or attempt == 3:
                    raise
                delay = 2 ** attempt
                if isinstance(error, httpx.HTTPStatusError):
                    header = error.response.headers.get("Retry-After", "")
                    if header.isdigit():
                        delay = max(delay, int(header))
                time.sleep(delay)
        # Keep exact response bytes: this is evidence for debugging upstream changes.
        (archive / f"page-{page:03}.json").write_bytes(response.content)
        payload = json.loads(response.content)
        batch = payload["records"]
        if not isinstance(batch, list):
            raise ValueError("Source records must be a list")
        records.extend(batch)
        if len(batch) < page_size:
            return records
    raise RuntimeError("Pagination exceeded safety bound")
