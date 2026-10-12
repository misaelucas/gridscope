"""Schedule selection depends on the tick, without a database or wall clock."""
from datetime import datetime

import dagster as dg
import pytest

from grid_report.definitions import daily_schedule


@pytest.mark.parametrize("scheduled_time,expected", [
    ("2021-06-15T04:15:00+00:00", "2021-06-14"),  # Historical/delayed summer tick.
    ("2026-01-01T05:15:00+00:00", "2025-12-31"),  # Year boundary.
    ("2026-03-29T04:15:00+00:00", "2026-03-28"),  # Spring transition tick.
    ("2026-03-30T04:15:00+00:00", "2026-03-29"),  # Report the 23-hour day.
    ("2026-10-25T05:15:00+00:00", "2026-10-24"),  # Autumn transition tick.
    ("2026-10-26T05:15:00+00:00", "2026-10-25"),  # Report the 25-hour day.
    # Synthetic evaluation: local date differs from UTC, proving conversion precedes subtraction.
    ("2025-12-31T23:30:00+00:00", "2025-12-31"),
])
def test_schedule_selects_previous_danish_day(scheduled_time, expected):
    with dg.build_schedule_context(
        scheduled_execution_time=datetime.fromisoformat(scheduled_time)
    ) as context:
        request = daily_schedule(context)
    assert isinstance(request, dg.RunRequest)
    assert request.partition_key == expected


def test_schedule_keeps_copenhagen_cron():
    assert daily_schedule.cron_schedule == "15 6 * * *"
    assert daily_schedule.execution_timezone == "Europe/Copenhagen"
