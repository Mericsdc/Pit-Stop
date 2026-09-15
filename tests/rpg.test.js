import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { createRpg, RPG_ITEMS } from '../src/rpg.js';

const GUILD = '1400000000000000000', OTHER = '1400000000000000009';
const user = { id: '1400000000000000001', username: 'Pilot' };
function fixture(t, roll = (min) => min) {
  const store = createStore(':memory:'); t.after(() => store.close());
  let time = 100000;
  const rpg = createRpg(store, { roll, now: () => time });
  return { store, rpg, advance: ms => { time += ms; } };
}

test('earnings, rare mining and independent durable cooldowns are bounded', t => {
  const { rpg, advance } = fixture(t);
  rpg.act(GUILD, user, 'work', null, 'work1');
  assert.equal(rpg.profile(GUILD, user).coins, 50);
  assert.throws(() => rpg.act(GUILD, user, 'work'), /beklemelisin/);
  rpg.act(GUILD, user, 'mine');
  assert.equal(rpg.profile(GUILD, user).coins, 150);
  advance(30 * 60000);
  assert.throws(() => rpg.act(GUILD, user, 'work', null, 'work1'), /zaten/);
  rpg.act(GUILD, user, 'work', null, 'work2');
  assert.equal(rpg.profile(GUILD, user).coins, 200);
  assert.equal(rpg.profile(OTHER, user).coins, 0);
});

test('purchase rejects insufficient funds, duplicate and forged items without changing balance', t => {
  const { store, rpg } = fixture(t);
  assert.throws(() => rpg.act(GUILD, user, 'buy', 'demir-kilic'), /yetmiyor/);
  assert.equal(store.getRecord(GUILD, 'rpg_player', user.id), null);
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 3000 });
  rpg.act(GUILD, user, 'buy', 'celik-kilic');
  rpg.act(GUILD, user, 'buy', 'demir-kilic');
  assert.equal(rpg.profile(GUILD, user).sword, 'celik-kilic');
  assert.equal(rpg.profile(GUILD, user).coins, 1950);
  assert.throws(() => rpg.act(GUILD, user, 'buy', 'demir-kilic'), /zaten/);
  assert.throws(() => rpg.act(GUILD, user, 'buy', '__proto__'), /bulunamadı/);
  assert.equal(rpg.profile(GUILD, user).coins, 1950);
});

test('battle dice, equipment and victory rewards are applied once', t => {
  const { store, rpg } = fixture(t, min => min);
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), sword: 'demir-kilic', armor: 'deri-zirh', inventory: ['demir-kilic','deri-zirh'] });
  const result = rpg.act(GUILD, user, 'battle', 'goblin', 'battle1');
  assert.match(result, /Kazandın/); // 1 + 2 + 1 = 1 + 3, tie wins.
  assert.equal(rpg.profile(GUILD, user).coins, 100);
  assert.equal(rpg.profile(GUILD, user).xp, 40);
  assert.equal(rpg.profile(GUILD, user).wins, 1);
  assert.throws(() => rpg.act(GUILD, user, 'battle', 'goblin', 'battle2'), /beklemelisin/);
});

test('defeat never creates negative balances or removes equipment', t => {
  const { store, rpg } = fixture(t);
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 7, sword: 'demir-kilic', inventory: ['demir-kilic'] });
  assert.match(rpg.act(GUILD, user, 'battle', 'ejderha'), /Yenildin/);
  assert.equal(rpg.profile(GUILD, user).coins, 0);
  assert.equal(rpg.profile(GUILD, user).losses, 1);
  assert.equal(rpg.profile(GUILD, user).sword, 'demir-kilic');
});

test('balances and cooldowns survive restart; ranking stays guild scoped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pitstop-rpg-'));
  let store;
  try {
    store = createStore(join(dir, 'test.sqlite'));
    createRpg(store).act(GUILD, user, 'work');
    const balance = store.getRecord(GUILD, 'rpg_player', user.id).coins;
    store.close(); store = createStore(join(dir, 'test.sqlite'));
    const rpg = createRpg(store);
    assert.equal(rpg.profile(GUILD, user).coins, balance);
    assert.throws(() => rpg.act(GUILD, user, 'work'), /beklemelisin/);
    store.putRecord(OTHER, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), xp: 99999 });
    store.putRecord(GUILD, 'rpg_player', '1400000000000000002', { ...rpg.profile(GUILD, user), name: 'Champion', xp: 200 });
    assert.deepEqual(store.rpgLeaderboard(GUILD).map(p => p.name), ['Champion', 'Pilot']);
  } finally { store?.close(); rmSync(dir, { recursive: true }); }
});

test('commands serialize and every shop choice matches a server-side item', t => {
  const { rpg } = fixture(t);
  const commands = rpg.commands.map(c => c.data.toJSON());
  assert.equal(commands.length, 24);
  assert.deepEqual(commands.find(c => c.name === 'satın-al').options[0].choices.map(c => c.value), RPG_ITEMS.filter(i => !i.source).map(i => i.id));
});

test('RPG guide explains every command privately without creating a player', async t => {
  const { rpg, store } = fixture(t);
  let reply, deferred;
  await rpg.commands.find(c => c.data.name === 'rpg-rehber').execute({
    guildId: GUILD, user, inGuild: () => true,
    deferReply: async options => { deferred = options; },
    editReply: async payload => { reply = payload; },
  });
  assert.equal(deferred.flags, 64);
  assert.ok(reply.content.length < 2000);
  for (const command of rpg.commands) assert.ok(reply.content.includes(`/${command.data.name}`));
  assert.equal(store.getRecord(GUILD, 'rpg_player', user.id), null);
});

test('parallel command submissions reward once and rejected actions recover', async t => {
  const { rpg } = fixture(t);
  const messages = [];
  const command = rpg.commands.find(c => c.data.name === 'çalış');
  const interaction = id => ({ id, guildId: GUILD, user, inGuild: () => true, options: { getString: () => null }, deferReply: async () => {}, editReply: async p => messages.push(p.content) });
  await Promise.all([command.execute(interaction('a')), command.execute(interaction('b'))]);
  assert.equal(rpg.profile(GUILD, user).coins, 50);
  assert.equal(messages.filter(m => m.includes('beklemelisin')).length, 1);
  rpg.act(GUILD, user, 'mine');
  assert.equal(rpg.profile(GUILD, user).coins, 150);
});
