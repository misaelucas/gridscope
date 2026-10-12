from datetime import date, timezone

import pytest

from grid_report.domain import expected_intervals, normalize


@pytest.mark.parametrize("day,expected", [(date(2026, 10, 10), 288),
                                          (date(2026, 3, 29), 276),
                                          (date(2026, 10, 25), 300)])
def test_local_day_length(day, expected):
    assert expected_intervals(day) == expected


def test_source_utc_without_offset_is_explicitly_utc():
    result = normalize({"Minutes5UTC": "2026-10-09T22:00:00", "PriceArea": "DK1", "CO2Emission": 0})
    assert result.timestamp.tzinfo == timezone.utc
    assert result.intensity == 0  # A genuine zero is valid, unlike a missing reading.


@pytest.mark.parametrize("value", [None, True, -1, "NaN", "Infinity"])
def test_invalid_values(value):
    with pytest.raises(ValueError):
        normalize({"Minutes5UTC": "2026-10-09T22:00:00", "PriceArea": "DK1", "CO2Emission": value})
