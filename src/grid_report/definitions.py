"""Step 7: Dagster calls the SAME pipeline as the CLI, avoiding divergent logic."""
from datetime import datetime, timedelta

import dagster as dg

from grid_report import db
from grid_report.domain import COPENHAGEN
from grid_report.pipeline import ingest_day

partitions = dg.DailyPartitionsDefinition(start_date="2020-01-01", timezone="Europe/Copenhagen")


@dg.asset(partitions_def=partitions, description="Validated five-minute CO2 intensity observations")
def carbon_observations(context: dg.AssetExecutionContext):
    from datetime import date
    db.init_db()
    result = ingest_day(date.fromisoformat(context.partition_key))
    context.add_output_metadata(result)


@dg.asset_check(asset=carbon_observations)
def complete_day(context: dg.AssetCheckExecutionContext):
    # Partition key comes from the run because checks execute alongside a partitioned asset.
    from datetime import date
    day = date.fromisoformat(context.run.tags["dagster/partition"])
    regions = db.report(day)
    return dg.AssetCheckResult(passed=all(r["missing_intervals"] == 0 for r in regions),
                               metadata={"regions": dg.MetadataValue.json(regions_to_json(regions))})


def regions_to_json(regions):
    return [{"area": r["area"], "missing_intervals": r["missing_intervals"]} for r in regions]


job = dg.define_asset_job("daily_carbon_report", selection=dg.AssetSelection.assets(carbon_observations))


@dg.schedule(job=job, cron_schedule="15 6 * * *", execution_timezone="Europe/Copenhagen")
def daily_schedule():
    yesterday = datetime.now(COPENHAGEN).date() - timedelta(days=1)
    return dg.RunRequest(partition_key=yesterday.isoformat())


defs = dg.Definitions(assets=[carbon_observations], asset_checks=[complete_day],
                      jobs=[job], schedules=[daily_schedule])
