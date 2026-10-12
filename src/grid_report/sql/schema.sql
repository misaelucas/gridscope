-- Step 3: the database enforces rules even if Python contains a bug.
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id uuid PRIMARY KEY,
    report_day date NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    received integer,
    error text,
    archive_path text NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
    observed_at timestamptz NOT NULL,
    area text NOT NULL CHECK (area IN ('DK1','DK2')),
    intensity double precision NOT NULL CHECK (intensity >= 0 AND intensity < 'Infinity'::float8),
    run_id uuid NOT NULL REFERENCES ingestion_runs(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (observed_at, area)
);
CREATE INDEX IF NOT EXISTS runs_day_idx ON ingestion_runs(report_day, started_at DESC);
