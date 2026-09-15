import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/store.js';
import { dashboardActivitySummary, recordDashboardActivity } from '../src/dashboard-activity.js';

const GUILD = '1400000000000000000';
const CHANNEL = '1400000000000000001';
const HOUR = 60 * 60_000;

test('dashboard activity stores real hourly message and command totals', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const now = Date.UTC(2026, 8, 15, 12, 30);
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'message', at: now });
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'message', at: now + 1_000 });
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'command', at: now + 2_000 });
  const summary = dashboardActivitySummary(store, GUILD, new Map([[CHANNEL, 'genel']]), now + 3_000);
  assert.equal(summary.todayMessages, 2);
  assert.equal(summary.todayCommands, 1);
  assert.equal(summary.series.at(-1).total, 3);
  assert.deepEqual(summary.activeChannel, { id: CHANNEL, name: 'genel', activity: 2 });
  assert.equal(summary.peakHour.activity, 3);
  assert.equal(summary.hasActivity, true);
});

test('dashboard activity compares the rolling day without inventing a percentage', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const now = Date.UTC(2026, 8, 15, 12, 30);
  let empty = dashboardActivitySummary(store, GUILD, new Map(), now);
  assert.equal(empty.changePercent, null);
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'message', at: now - 25 * HOUR });
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'message', at: now });
  recordDashboardActivity(store, { guildId: GUILD, channelId: CHANNEL, kind: 'command', at: now });
  empty = dashboardActivitySummary(store, GUILD, new Map([[CHANNEL, 'genel']]), now);
  assert.equal(empty.changePercent, 100);
});
