"""Step 4 entry point: explicit date ranges make backfills reproducible."""
import argparse
import json
from datetime import date, timedelta

from grid_report import db
from grid_report.pipeline import ingest_day


def main():
    parser = argparse.ArgumentParser(description="Dates are Danish local days; end is exclusive.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    ingest = sub.add_parser("ingest")
    ingest.add_argument("--start", type=date.fromisoformat, required=True)
    ingest.add_argument("--end", type=date.fromisoformat, required=True)
    reporting = sub.add_parser("report")
    reporting.add_argument("--day", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    if args.command == "init":
        db.init_db()
    elif args.command == "report":
        print(json.dumps(db.report(args.day), default=str, indent=2))
    else:
        if not 0 < (args.end - args.start).days <= 366:
            parser.error("Choose an end after start and at most 366 days")
        db.init_db()
        day = args.start
        while day < args.end:
            print(json.dumps(ingest_day(day)))
            day += timedelta(days=1)
