-- Step 5: start with the EXPECTED intervals, then LEFT JOIN actual observations.
-- Missing data remains NULL. AVG ignores NULL: it never silently counts gaps as zero.
WITH slots AS (
    SELECT generate_series(%(start)s::timestamptz,
                           %(end)s::timestamptz - interval '5 minutes',
                           interval '5 minutes') AS observed_at
), areas AS (SELECT unnest(ARRAY['DK1','DK2']) AS area)
SELECT a.area,
       count(o.intensity)::integer AS observed_intervals,
       count(*)::integer AS expected_intervals,
       (count(*) - count(o.intensity))::integer AS missing_intervals,
       round((100.0 * count(o.intensity) / count(*)), 2)::float8 AS completeness_percent,
       avg(o.intensity) AS average_g_per_kwh,
       max(o.intensity) AS peak_g_per_kwh,
       min(o.intensity) AS minimum_g_per_kwh,
       max(o.observed_at) AS latest_observation,
       max(o.updated_at) AS last_ingested_at
FROM slots s CROSS JOIN areas a
LEFT JOIN observations o ON o.observed_at = s.observed_at AND o.area = a.area
GROUP BY a.area ORDER BY a.area;
