import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, parseRefreshDays, serializeRefreshDays, nextRefreshDate, formatRefreshSchedule } from '../src/schedule.ts';

test('normalizes legacy schedules and selected weekdays, with None as null', () => {
  assert.equal(normalizeSchedule(null), null);
  assert.equal(serializeRefreshDays([]), null);
  assert.equal(normalizeSchedule('daily'), 'days:0,1,2,3,4,5,6');
  assert.equal(normalizeSchedule('weekly:5'), 'days:5');
  assert.equal(normalizeSchedule('weekly', new Date('2026-10-09T00:00:00Z')), 'days:5');
  assert.equal(normalizeSchedule('days:6,0,3'), 'days:0,3,6');
});

test('rejects malformed schedule input instead of scheduling tomorrow', () => {
  for (const value of [undefined, '', 'none', 'days:', 'days:7', 'days:-1', 'days:1,1', 'days:1.5', 'days:01', 'days:0,', 'weekly:8', 'weekly:1junk', {}, [], 2]) {
    assert.throws(() => parseRefreshDays(value), /Schedule|duplicates/);
  }
  for (const days of [[-1], [7], [NaN], [1.5]]) assert.throws(() => serializeRefreshDays(days));
});

for (const [label, schedule, now, expected] of [
  ['next selected day', 'days:0,2,4', '2026-10-06T12:30:00Z', '2026-10-08T00:00:00.000Z'],
  ['Saturday to Sunday', 'days:0', '2026-10-10T23:59:59Z', '2026-10-11T00:00:00.000Z'],
  ['same weekday moves a week ahead', 'days:0', '2026-10-11T00:00:00Z', '2026-10-18T00:00:00.000Z'],
  ['year boundary', 'days:5', '2026-12-31T18:00:00Z', '2027-01-01T00:00:00.000Z'],
  ['leap day', 'days:2', '2028-02-28T22:00:00Z', '2028-02-29T00:00:00.000Z'],
  ['month boundary', 'days:3', '2026-09-30T18:00:00Z', '2026-10-07T00:00:00.000Z'],
  ['all seven days', 'days:0,1,2,3,4,5,6', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00.000Z'],
  ['legacy daily', 'daily', '2026-10-06T23:59:59Z', '2026-10-07T00:00:00.000Z'],
  ['legacy weekday', 'weekly:5', '2026-10-06T12:00:00Z', '2026-10-09T00:00:00.000Z'],
  ['late execution advances to a future selected day', 'days:1,5', '2026-10-07T10:00:00Z', '2026-10-09T00:00:00.000Z'],
]) {
  test(`refresh calculation: ${label}`, () => {
    assert.equal(nextRefreshDate(schedule, new Date(now)).toISOString(), expected);
  });
}

test('schedule summaries distinguish all days, None, and repeated initials', () => {
  assert.equal(formatRefreshSchedule(null), 'None · Manual refresh only');
  assert.equal(formatRefreshSchedule('daily'), 'Every day · 00:00 UTC');
  assert.equal(formatRefreshSchedule('days:0,2,4,6'), 'Sun, Tue, Thu, Sat · 00:00 UTC');
});
