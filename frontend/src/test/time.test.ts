import { describe, expect, it } from 'vitest';
import { copenhagenTimestamp, previousDanishDay } from '../time';
import { mergeSeries } from '../api';
import { series } from './fixtures';

describe('calendar yesterday', () => {
  it.each([
    ['2026-03-29T22:30:00Z', '2026-03-29'],
    ['2026-10-25T23:30:00Z', '2026-10-25'],
    ['2026-10-25T22:30:00Z', '2026-10-24'],
    ['2026-03-28T23:30:00Z', '2026-03-28'],
    ['2025-12-31T23:30:00Z', '2025-12-31'],
    ['2024-03-01T00:30:00Z', '2024-02-29'],
  ])('%s', (instant, expected) => expect(previousDanishDay(new Date(instant))).toBe(expected));
});
it('formats both repeated local clock times with distinct UTC offsets', () => {
  expect(copenhagenTimestamp('2026-10-25T00:30:00Z')).toBe('2026-10-25 02:30:00 UTC+02:00');
  expect(copenhagenTimestamp('2026-10-25T01:30:00Z')).toBe('2026-10-25 02:30:00 UTC+01:00');
  expect(copenhagenTimestamp('2026-03-29T01:00:00Z')).toBe('2026-03-29 03:00:00 UTC+02:00');
});
it('merges by UTC instant, retains zero/null, sorts chronologically and fills missing region slots', () => {
  const dk1 = series('DK1');
  dk1.observations.reverse();
  const dk2 = series('DK2', '2026-10-10', [7]);
  dk2.observations[0].timestamp = '2026-10-10T02:00:00+02:00'; // Same instant, different spelling.
  const points = mergeSeries(dk1, dk2);
  expect(points.map(point => [point.DK1, point.DK2])).toEqual([[0, 7], [null, null], [20, null]]);
  expect(points.map(point => point.instant)).toEqual([...points.map(point => point.instant)].sort());
});
it.each([
  ['2026-03-28T23:00:00Z', 276], ['2026-10-09T22:00:00Z', 288], ['2026-10-24T22:00:00Z', 300],
])('preserves every five-minute slot starting %s', (start, count) => {
  const dk1 = series('DK1');
  dk1.observations = Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.parse(start) + i * 300_000).toISOString(), intensity: i % 2 ? null : 0,
  }));
  const dk2 = { ...dk1, area: 'DK2' as const };
  const points = mergeSeries(dk1, dk2);
  expect(points).toHaveLength(count);
  expect(new Set(points.map(point => point.instant)).size).toBe(count);
  expect(points.every((point, i) => i === 0 || point.instant - points[i - 1].instant === 300_000)).toBe(true);
});
