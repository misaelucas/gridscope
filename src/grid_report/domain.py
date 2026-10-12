"""Step 1: define time and validation rules without network/database dependencies."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
from zoneinfo import ZoneInfo

COPENHAGEN = ZoneInfo("Europe/Copenhagen")


def day_bounds(day: date) -> tuple[datetime, datetime]:
    # Convert EACH midnight separately: DST days contain 23 or 25 real hours.
    start = datetime.combine(day, time.min, COPENHAGEN)
    end = datetime.combine(day + timedelta(days=1), time.min, COPENHAGEN)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def expected_intervals(day: date) -> int:
    start, end = day_bounds(day)
    return int((end - start).total_seconds() / 300)


@dataclass(frozen=True)
class Observation:
    timestamp: datetime
    area: str
    intensity: float


def normalize(record: dict) -> Observation:
    timestamp = datetime.fromisoformat(record["Minutes5UTC"])
    # The upstream field explicitly says UTC, even though JSON omits the offset.
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp = timestamp.astimezone(timezone.utc)
    area = record["PriceArea"]
    value = record["CO2Emission"]
    if value is None or isinstance(value, bool):
        raise ValueError("CO2Emission must be a number")
    intensity = float(value)
    if area not in {"DK1", "DK2"} or not isfinite(intensity) or intensity < 0:
        raise ValueError("Invalid region or carbon intensity")
    if timestamp.minute % 5 or timestamp.second or timestamp.microsecond:
        raise ValueError("Observation is not aligned to a five-minute interval")
    return Observation(timestamp, area, intensity)
