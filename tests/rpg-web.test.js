import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/store.js';
import { createRpg } from '../src/rpg.js';

const GUILD = '1400000000000000000';
const user = { id: '1400000000000000001', username: 'WebPilot' };

function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let time = 1_800_000;
  const rpg = createRpg(store, { now: () => time, roll: min => min });
  return { store, rpg, advance: value => { time += value; } };
}

test('web activity persists, uses server time and rewards only once', t => {
  const { store, rpg, advance } = fixture(t);
  const started = rpg.startActivity(GUILD, user, 'mine', 'web_start_1');
  assert.equal(started.endsAt - started.startedAt, 15 * 60_000);
  assert.equal(rpg.webState(GUILD, user).activity.status, 'active');
  assert.throws(() => rpg.startActivity(GUILD, user, 'work', 'web_start_2'), /başka bir işlem/);
  assert.throws(() => rpg.claimActivity(GUILD, user, 'web_claim_early'), /saniye var/);

  advance(15 * 60_000);
  assert.equal(rpg.webState(GUILD, user).activity.status, 'ready');
  const claimed = rpg.claimActivity(GUILD, user, 'web_claim_1');
  assert.match(claimed.result, /Cevher|kristal/);
  const balance = rpg.profile(GUILD, user).coins;
  assert.ok(balance > 0);
  assert.throws(() => rpg.claimActivity(GUILD, user, 'web_claim_1'), /zaten/);
  assert.equal(rpg.profile(GUILD, user).coins, balance);
  assert.equal(store.listRecords(GUILD, 'rpg_transaction').filter(item => item.playerId === user.id).length, 2);
});

test('website and Discord actions share one player, inventory and economy ledger', t => {
  const { store, rpg, advance } = fixture(t);
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 2500 });
  rpg.act(GUILD, user, 'buy', 'demir-kilic', 'discord_buy_1');
  let state = rpg.webState(GUILD, user, { avatar: 'https://cdn.example/avatar.webp' });
  assert.equal(state.player.avatar, 'https://cdn.example/avatar.webp');
  assert.equal(state.equipment.sword.id, 'demir-kilic');
  assert.equal(state.inventory.find(item => item.id === 'demir-kilic').equipped, true);

  advance(30 * 60_000);
  rpg.startActivity(GUILD, user, 'work', 'web_work_1');
  advance(30 * 60_000);
  rpg.claimActivity(GUILD, user, 'web_work_claim_1');
  state = rpg.webState(GUILD, user);
  assert.equal(state.player.coins, rpg.profile(GUILD, user).coins);
  assert.ok(state.player.economy.earned > 0);
  assert.ok(state.player.economy.spent > 0);
  assert.ok(state.transactions.some(item => item.type === 'buy'));
  assert.ok(state.transactions.some(item => item.type === 'work_reward'));
});

test('shop items can be sold once with server price and equipped fallback', t => {
  const { store, rpg } = fixture(t);
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 3000 });
  rpg.act(GUILD, user, 'buy', 'demir-kilic', 'buy_iron');
  rpg.act(GUILD, user, 'buy', 'celik-kilic', 'buy_steel');
  assert.equal(rpg.profile(GUILD, user).sword, 'celik-kilic');

  assert.match(rpg.sell(GUILD, user, 'celik-kilic', 'sell_steel'), /400 altına/);
  const player = rpg.profile(GUILD, user);
  assert.equal(player.coins, 2350);
  assert.equal(player.sword, 'demir-kilic');
  assert.ok(!player.inventory.includes('celik-kilic'));
  assert.throws(() => rpg.sell(GUILD, user, 'celik-kilic', 'sell_again'), /bulunmuyor/);
  assert.throws(() => rpg.sell(GUILD, user, 'ejder-kilic', 'sell_special'), /normal mağazadan/);
  assert.equal(store.listRecords(GUILD, 'rpg_transaction').filter(item => item.type === 'sell').length, 1);
});

test('web state hides completed or malformed activities and exposes finite market timer', t => {
  const { store, rpg } = fixture(t);
  store.putRecord(GUILD, 'rpg_activity', user.id, { status: 'claimed', startedAt: null, endsAt: null });
  let state = rpg.webState(GUILD, user);
  assert.equal(state.activity, null);
  assert.ok(Number.isFinite(state.world.marketTarget));
  assert.ok(state.world.marketTarget > state.serverTime);

  store.putRecord(GUILD, 'rpg_activity', user.id, { status: 'active', startedAt: 'bozuk', endsAt: 'bozuk' });
  state = rpg.webState(GUILD, user);
  assert.equal(state.activity, null);
});
