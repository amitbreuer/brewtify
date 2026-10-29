import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVE_KEY,
  ACTIVE_WINDOW_SECONDS,
  MARK_INTERVAL_MS,
  PartyActivity,
  SWEEP_INTERVAL_SECONDS,
  SWEPT_KEY,
  type ActivityStore,
} from './activity';

function fakeStore(clock: { now: number }) {
  const values = new Map<string, { value: string; expiresAt: number }>();
  let failing = false;
  let sets = 0;
  const live = (key: string) => {
    const entry = values.get(key);
    return entry && entry.expiresAt > clock.now ? entry.value : null;
  };
  const store: ActivityStore = {
    async mget(...keys) {
      if (failing) throw new Error('redis down');
      return keys.map(live);
    },
    async set(key, value, { ex }) {
      if (failing) throw new Error('redis down');
      sets++;
      values.set(key, { value, expiresAt: clock.now + ex * 1000 });
      return 'OK';
    },
  };
  return {
    store,
    fail: (value: boolean) => { failing = value; },
    sets: () => sets,
  };
}

test('idle Party skips maintenance after a sweep until the daily sweep is due', async () => {
  const clock = { now: 1_000_000 };
  const { store } = fakeStore(clock);
  const activity = new PartyActivity(store, () => clock.now);

  assert.equal(await activity.maintenanceDue(), true, 'first run sweeps any backlog');
  await activity.recordMaintenance();
  assert.equal(await activity.maintenanceDue(), false);

  clock.now += SWEEP_INTERVAL_SECONDS * 1000 - 1;
  assert.equal(await activity.maintenanceDue(), false);
  clock.now += 1;
  assert.equal(await activity.maintenanceDue(), true);
});

test('Party activity keeps maintenance running past the longest row lifetime', async () => {
  const clock = { now: 1_000_000 };
  const { store } = fakeStore(clock);
  const activity = new PartyActivity(store, () => clock.now);
  await activity.recordMaintenance();

  await activity.mark();
  for (const elapsedHours of [0, 1, 12]) {
    clock.now = 1_000_000 + elapsedHours * 3600_000;
    assert.equal(await activity.maintenanceDue(), true, `due ${elapsedHours}h after activity`);
    await activity.recordMaintenance();
  }
  clock.now = 1_000_000 + ACTIVE_WINDOW_SECONDS * 1000;
  assert.equal(await activity.maintenanceDue(), false);
});

test('activity marks are throttled per process', async () => {
  const clock = { now: 1_000_000 };
  const fake = fakeStore(clock);
  const activity = new PartyActivity(fake.store, () => clock.now);

  await activity.mark();
  await activity.mark();
  clock.now += MARK_INTERVAL_MS - 1;
  await activity.mark();
  assert.equal(fake.sets(), 1);
  clock.now += 1;
  await activity.mark();
  assert.equal(fake.sets(), 2);
});

test('unknown activity state runs maintenance and never fails requests', async () => {
  const clock = { now: 1_000_000 };
  const fake = fakeStore(clock);
  const activity = new PartyActivity(fake.store, () => clock.now);
  await activity.recordMaintenance();

  fake.fail(true);
  await assert.doesNotReject(activity.mark());
  await assert.doesNotReject(activity.recordMaintenance());
  assert.equal(await activity.maintenanceDue(), true);

  fake.fail(false);
  await activity.mark();
  assert.equal(fake.sets(), 2, 'a failed mark is retried on the next request');

  const unconfigured = new PartyActivity(undefined);
  await assert.doesNotReject(unconfigured.mark());
  assert.equal(await unconfigured.maintenanceDue(), true);
});

test('activity keys are namespaced for Party maintenance', () => {
  assert.match(ACTIVE_KEY, /^party:maintenance:/);
  assert.match(SWEPT_KEY, /^party:maintenance:/);
  assert.ok(ACTIVE_WINDOW_SECONDS > 12 * 60 * 60);
});
