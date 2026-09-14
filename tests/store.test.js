import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';
const OTHER_GUILD = '1400000000000000001';
const ROLE = '1400000000000000002';
const USER = '1400000000000000003';

function memory(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  return store;
}

test('settings default safely and remain isolated across guilds and returned objects', (t) => {
  const store = memory(t);
  const first = store.getSettings(GUILD);
  assert.equal(first.musicVolume, 50);
  assert.equal(first.autoRoleEnabled, false);
  assert.equal(first.leaveMessage, '{user} sunucudan ayrıldı.');
  first.responses.push({ trigger: 'outside', reply: 'mutation' });
  assert.deepEqual(store.getSettings(GUILD).responses, []);
  store.updateSettings(GUILD, { musicEnabled: true, musicVolume: 75 });
  assert.equal(store.getSettings(GUILD).musicVolume, 75);
  assert.equal(store.getSettings(OTHER_GUILD).musicEnabled, false);
});

test('settings persist on disk and updates merge with previous values', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pit-stop-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'nested', 'bot.sqlite');
  const first = createStore(path);
  first.updateSettings(GUILD, { leaveChannelId: ROLE, leaveEnabled: true });
  first.updateSettings(GUILD, { musicVolume: 12 });
  first.close();
  const second = createStore(path);
  assert.equal(second.getSettings(GUILD).leaveChannelId, ROLE);
  assert.equal(second.getSettings(GUILD).leaveEnabled, true);
  assert.equal(second.getSettings(GUILD).musicVolume, 12);
  second.close();
});

for (const [label, patch] of [
  ['unknown fields', { discordToken: 'secret' }],
  ['incorrect boolean', { musicEnabled: 'true' }],
  ['small volume', { musicVolume: 0 }],
  ['large volume', { musicVolume: 101 }],
  ['fractional volume', { musicVolume: 1.5 }],
  ['invalid snowflake', { autoRoleId: '1234' }],
  ['overlarge snowflake', { autoRoleId: '99999999999999999999' }],
  ['numeric snowflake', { autoRoleId: 1400000000000000002 }],
  ['blank leave template', { leaveMessage: '   ' }],
  ['oversized template', { leaveMessage: 'a'.repeat(1001) }],
  ['unknown placeholder', { leaveMessage: 'Goodbye {token}' }],
  ['too many responders', { responses: Array.from({ length: 51 }, (_, index) => ({ trigger: `x${index}`, reply: 'yes' })) }],
  ['duplicate responder', { responses: [{ trigger: '!YARIŞ', reply: 'yes' }, { trigger: 'yarış', reply: 'no' }] }],
  ['nested unknown responder key', { responses: [{ trigger: 'ok', reply: 'yes', token: 'secret' }] }],
  ['blank responder', { responses: [{ trigger: 'ok', reply: '' }] }],
  ['oversized responder', { responses: [{ trigger: 'ok', reply: 'a'.repeat(1901) }] }],
  ['multiword responder', { responses: [{ trigger: 'two words', reply: 'yes' }] }],
]) {
  test(`invalid settings reject ${label} without saving partial changes`, (t) => {
    const store = memory(t);
    const previous = store.getSettings(GUILD);
    assert.throws(() => store.updateSettings(GUILD, { musicEnabled: true, ...patch }), TypeError);
    assert.deepEqual(store.getSettings(GUILD), previous);
  });
}

test('dependent settings must have a channel or role and failed transactions recover', (t) => {
  const store = memory(t);
  assert.throws(() => store.updateSettings(GUILD, { leaveEnabled: true }), /kanal/u);
  assert.throws(() => store.updateSettings(GUILD, { autoRoleEnabled: true }), /rol/u);
  store.updateSettings(GUILD, { autoRoleEnabled: true, autoRoleId: ROLE });
  assert.throws(() => store.updateSettings(GUILD, { autoRoleId: null }), /rol/u);
  assert.equal(store.getSettings(GUILD).autoRoleId, ROLE);
  store.updateSettings(GUILD, { autoRoleEnabled: false, autoRoleId: null });
  assert.equal(store.getSettings(GUILD).autoRoleId, null);
});

test('responders normalize Turkish case and optional command prefix', (t) => {
  const store = memory(t);
  const saved = store.updateSettings(GUILD, {
    responderEnabled: true,
    responses: [{ trigger: '!YARIŞ', reply: ' Başlıyoruz! ' }],
  });
  assert.deepEqual(saved.responses, [{ trigger: 'yarış', reply: 'Başlıyoruz!' }]);
});

test('one-time records are consumed atomically and cannot be replayed', (t) => {
  const store = memory(t);
  store.putRecord(GUILD, 'panel_login_code', 'a'.repeat(64), { userId: USER, expiresAt: Date.now() + 60_000 });
  const first = store.consumeRecord(GUILD, 'panel_login_code', 'a'.repeat(64));
  assert.equal(first.userId, USER);
  assert.equal(store.consumeRecord(GUILD, 'panel_login_code', 'a'.repeat(64)), null);
  store.putRecord(GUILD, 'panel_login_code', 'b'.repeat(64), { userId: USER, expiresAt: Date.now() - 1 });
  assert.equal(store.consumeRecord(GUILD, 'panel_login_code', 'b'.repeat(64)), null);
});

test('logs isolate guilds, filter types and paginate by id without duplicates', (t) => {
  const store = memory(t);
  const first = store.addLog(GUILD, { type: 'member.join', actorId: USER, message: 'Katıldı.', details: { memberId: USER } });
  const second = store.addLog(GUILD, { type: 'member.leave', actorId: USER, message: 'Ayrıldı.' });
  const third = store.addLog(GUILD, { type: 'member.join', message: 'Katıldı.' });
  store.addLog(OTHER_GUILD, { type: 'member.join', message: 'Başka sunucu.' });
  assert.deepEqual(store.getLogs(GUILD, { limit: 2 }).map(({ id }) => id), [third.id, second.id]);
  assert.deepEqual(store.getLogs(GUILD, { before: String(second.id) }).map(({ id }) => id), [first.id]);
  assert.deepEqual(store.getLogs(GUILD, { type: 'member.join' }).map(({ id }) => id), [third.id, first.id]);
  assert.equal(store.getLogs(OTHER_GUILD).length, 1);
  assert.equal(store.getLogs(GUILD).at(-1).details.memberId, USER);
  assert.equal(typeof first.createdAt, 'number');
});

test('automatic crew refresh noise stays hidden while manual crew logs remain visible', (t) => {
  const store = memory(t);
  store.addLog(GUILD, { type: 'crew.refreshed', actorId: null, message: 'Otomatik yenileme' });
  store.addLog(GUILD, { type: 'crew.refreshed', actorId: USER, message: 'Elle yenileme', details: { actorName: 'Pilot' } });
  assert.deepEqual(store.getLogs(GUILD).map(log => log.message), ['Elle yenileme']);
  assert.equal(store.getLogs(GUILD, { type: 'crew.refreshed' }).length, 2);
});

test('logs reject invalid metadata and query controls', (t) => {
  const store = memory(t);
  for (const entry of [
    { type: '../bad', message: 'No' },
    { type: 'valid', actorId: 'not-id', message: 'No' },
    { type: 'valid', message: 'x'.repeat(501) },
    { type: 'valid', message: 'Fine', details: [] },
    { type: 'valid', message: 'Fine', details: { text: 'x'.repeat(4000) } },
    { type: 'valid', message: 'Fine', content: 'forbidden field' },
  ]) assert.throws(() => store.addLog(GUILD, entry), TypeError);
  for (const options of [{ limit: 0 }, { limit: 101 }, { before: 'x' }, { before: -1 }, { type: 'drop table' }, { unknown: true }]) {
    assert.throws(() => store.getLogs(GUILD, options), TypeError);
  }
  assert.throws(() => store.getSettings('wrong'), TypeError);
  assert.equal(store.getLogs(GUILD).length, 0);
});

test('retention removes records older than 30 days and caps each guild at 10000', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pit-stop-retention-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'bot.sqlite');
  const initial = createStore(path);
  initial.close();
  const seed = new DatabaseSync(path);
  const insert = seed.prepare(`INSERT INTO audit_logs(guild_id,type,actor_id,message,details_json,created_at)
    VALUES (?,'test',NULL,'Test','{}',?)`);
  seed.exec('BEGIN');
  insert.run(OTHER_GUILD, Date.now() - 31 * 24 * 60 * 60 * 1000);
  for (let index = 0; index < 10_005; index += 1) insert.run(GUILD, Date.now());
  insert.run(OTHER_GUILD, Date.now());
  seed.exec('COMMIT');
  seed.close();
  const store = createStore(path);
  store.addLog(GUILD, { type: 'new', message: 'Yeni.' });
  const inspect = new DatabaseSync(path);
  assert.equal(inspect.prepare('SELECT COUNT(*) AS total FROM audit_logs WHERE guild_id = ?').get(GUILD).total, 10000);
  assert.equal(store.getLogs(OTHER_GUILD).length, 1);
  assert.equal(store.getLogs(GUILD, { limit: 1 })[0].type, 'new');
  inspect.close();
  store.close();
});
