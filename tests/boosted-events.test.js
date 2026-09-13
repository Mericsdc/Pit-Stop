import assert from 'node:assert/strict';
import test from 'node:test';
import { classEmoji, createBoostedEventMonitor, nextBoostedRefreshDelay, nextHalfHourDelay, normalizeBoostedEvent, parseLeaderboardDescription } from '../src/boosted-events.js';
import { createStore } from '../src/store.js';

const GUILD = '1546438919212503090';
const CHANNEL = '1548751646165831851';

test('Boosted Event data and leaderboard class are normalized defensively', () => {
  assert.equal(nextHalfHourDelay(Date.parse('2026-09-13T10:12:00Z')), 18 * 60_000);
  assert.equal(nextHalfHourDelay(Date.parse('2026-09-13T10:30:00Z')), 30 * 60_000);
  assert.equal(nextBoostedRefreshDelay(Date.parse('2026-09-13T10:29:50Z')), 100_000);
  assert.equal(nextBoostedRefreshDelay(Date.parse('2026-09-13T10:30:20Z')), 70_000);
  assert.equal(nextBoostedRefreshDelay(Date.parse('2026-09-13T10:32:00Z')), 29.5 * 60_000);
  assert.equal(classEmoji('Class D'), '🟢');
  assert.equal(classEmoji('Sınıf belirtilmedi'), '🏁');
  assert.deepEqual(normalizeBoostedEvent([{ id: '377', name: 'OUTLAWS (TEAM ESCAPE)', eventModeId: '24', isBoosted: '1' }]), { id: '377', name: 'OUTLAWS', type: 'Team Escape', eventModeId: '24' });
  assert.deepEqual(parseLeaderboardDescription('<meta name="description" content="Class D · Team Escape">'), { className: 'Class D', description: 'Class D · Team Escape' });
  assert.equal(normalizeBoostedEvent([{ id: '1', name: 'Race', isBoosted: '0' }]), null);
});

test('monitor announces a new event once and persists its latest status', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  const sent = [];
  const client = { guilds: { cache: new Map([[GUILD, { channels: { fetch: async id => id === CHANNEL ? { isTextBased: () => true, send: async payload => { sent.push(payload); } } : null } }]]) } };
  let raceId = '377';
  const fetcher = async (url) => String(url).includes('gateway.php')
    ? Response.json([{ id: raceId, name: raceId === '377' ? 'OUTLAWS (TEAM ESCAPE)' : 'ROSEWOOD', eventModeId: '24', isBoosted: '1' }])
    : new Response(`<meta name="description" content="Class ${raceId === '377' ? 'D' : 'A'} · Team Escape">`);
  const monitor = createBoostedEventMonitor(client, store, { allowedGuildIds: [GUILD], boostedEventChannelId: CHANNEL }, { fetcher, now: () => 1_000 });
  t.after(() => monitor.close());
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /OUTLAWS/);
  assert.match(sent[0].content, /Class D/);
  assert.match(sent[0].content, /🟢 Class D/);
  assert.match(sent[0].content, /https:\/\/nightriderz\.world\/leaderboard\/377/);
  assert.match(sent[0].content, /\*\*Tür:\*\* Team Escape\n\*\*Bitiş:\*\* <t:1800:t> \(<t:1800:R>\)/);
  assert.equal(store.getRecord(GUILD, 'boosted_event', 'current').event.endsAt, 1_800_000);
  raceId = '378';
  await monitor.refresh();
  assert.equal(sent.length, 2);
  assert.equal(store.getRecord(GUILD, 'boosted_event', 'current').event.className, 'Class A');
});
