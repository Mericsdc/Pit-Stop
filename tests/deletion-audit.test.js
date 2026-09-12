import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent, Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createDeletionAudit, rememberCommandDeletion, commandDeletionActor } from '../src/deletion-audit.js';

const createEntry = (overrides = {}) => ({ id: 'entry', executorId: 'mod', executor: { username: 'Yetkili' }, targetId: 'author', createdTimestamp: 10000, extra: { channel: { id: 'channel' }, count: 1 }, ...overrides });
function fixture(initial = [createEntry()]) {
  let values = initial; const requests = [];
  const guild = { id: 'guild', members: { me: { permissions: new PermissionsBitField(P.ViewAuditLog) } }, fetchAuditLogs: async options => { requests.push(options); return { entries: new Collection(values.map(e => [e.id, e])) }; } };
  const audit = createDeletionAudit({ now: () => 11000, delay: async () => {} });
  return { guild, audit, requests, setEntries: entries => { values = entries; } };
}
test('single deletion identifies the moderator, never the original author', async () => {
  const f = fixture(); const result = await f.audit.resolve(f.guild, { channelId: 'channel', authorId: 'author', observedAt: 10000 });
  assert.equal(result.actorId, 'mod'); assert.equal(result.actorName, 'Yetkili'); assert.equal(f.requests[0].type, AuditLogEvent.MessageDelete);
  const replay = await f.audit.resolve(f.guild, { channelId: 'channel', authorId: 'author', observedAt: 10000 }); assert.equal(replay.actorId, null);
});
test('wrong author/channel, old entries and missing permission do not falsely implicate someone', async () => {
  for (const overrides of [{ targetId: 'someone-else' }, { extra: { channel: { id: 'other' }, count: 1 } }, { createdTimestamp: 100 }]) {
    const f = fixture([createEntry(overrides)]); assert.equal((await f.audit.resolve(f.guild, { channelId: 'channel', authorId: 'author', observedAt: 10000 })).actorId, null);
  }
  const f = fixture(); f.guild.members.me.permissions = new PermissionsBitField(); assert.equal((await f.audit.resolve(f.guild, { channelId: 'channel', authorId: 'author' })).actorId, null); assert.equal(f.requests.length, 0);
});
test('aggregated audit counts only attribute newly observed deletions after priming', async () => {
  const f = fixture([createEntry({ createdTimestamp: 1, extra: { channel: { id: 'channel' }, count: 4 } })]);
  await f.audit.prime(f.guild); f.setEntries([createEntry({ createdTimestamp: 1, extra: { channel: { id: 'channel' }, count: 5 } })]);
  const opts = { channelId: 'channel', authorId: 'author', observedAt: 10000 };
  assert.equal((await f.audit.resolve(f.guild, opts)).actorId, 'mod'); assert.equal((await f.audit.resolve(f.guild, opts)).actorId, null);
});
test('bulk deletion uses the channel target and requires a sufficient count', async () => {
  const f = fixture([createEntry({ targetId: 'channel', extra: { count: 5 } })]);
  assert.equal((await f.audit.resolve(f.guild, { bulk: true, channelId: 'channel', count: 5, observedAt: 10000 })).actorId, 'mod');
  assert.equal(f.requests[0].type, AuditLogEvent.MessageBulkDelete);
});
test('ambiguous concurrent moderator actions stay unassigned', async () => {
  const f = fixture([createEntry(), createEntry({ id: 'other', executorId: 'second-mod' })]);
  assert.equal((await f.audit.resolve(f.guild, { channelId: 'channel', authorId: 'author', observedAt: 10000 })).actorId, null);
});
test('clear command attributes exact deleted message IDs to the invoking administrator', () => {
  const client = {}; const cancel = rememberCommandDeletion(client, ['one', 'two'], { id: 'owner', username: 'Sahip' });
  assert.equal(commandDeletionActor(client, ['one', 'two']).actorId, 'owner'); assert.equal(commandDeletionActor(client, ['one']), null);
  rememberCommandDeletion(client, ['three'], { id: 'owner', username: 'Sahip' })(); assert.equal(commandDeletionActor(client, ['three']), null); cancel();
});
