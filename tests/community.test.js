import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ChannelType, Collection, Events, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { installCommunityHandlers } from '../src/community.js';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';
const USER = '1400000000000000001';
const ROLE = '1400000000000000002';
const CHANNEL = '1400000000000000003';
const BOT = '1400000000000000004';

function setup(t) {
  const store = createStore(':memory:');
  const client = new EventEmitter();
  client.user = { id: BOT };
  const sent = [];
  const assigned = [];
  const diagnostics = [];
  const role = { id: ROLE, editable: true, managed: false };
  const guild = {
    id: GUILD, name: 'Garaj', memberCount: 42,
    members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles) } },
    roles: { fetch: async () => role },
  };
  const channel = {
    id: CHANNEL, guildId: GUILD, guild, type: ChannelType.GuildText,
    send: async (payload) => { sent.push(payload); },
  };
  guild.channels = {
    cache: new Collection([[CHANNEL, channel]]),
    fetch: async () => channel,
  };
  const member = {
    id: USER, guild, user: { id: USER, username: 'Pilot', bot: false },
    roles: { add: async (...args) => { assigned.push(args); }, cache: new Collection() },
  };
  const uninstall = installCommunityHandlers(client, store, { logger: (...args) => diagnostics.push(args) });
  t.after(() => { uninstall(); store.close(); });
  const emit = async (event, ...args) => Promise.all(client.listeners(event).map((listener) => listener(...args)));
  return { store, client, sent, assigned, diagnostics, role, guild, channel, member, emit, uninstall };
}

function incoming(fixture, content = '!selam', overrides = {}) {
  return {
    id: '1400000000000000005', guild: fixture.guild, channelId: CHANNEL,
    author: { id: USER, bot: false }, content,
    reply: async (payload) => { fixture.sent.push(payload); },
    ...overrides,
  };
}

test('disabled features only log membership changes', async (t) => {
  const fixture = setup(t);
  await fixture.emit(Events.GuildMemberAdd, fixture.member);
  await fixture.emit(Events.GuildMemberRemove, fixture.member);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.assigned.length, 0);
  assert.deepEqual(fixture.store.getLogs(GUILD).map(({ type }) => type), ['member.leave', 'member.join']);
});

test('leave templates replace all supported variables without mentions', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, {
    leaveEnabled: true, leaveChannelId: CHANNEL,
    leaveMessage: '{user} / {username} / {server} / {memberCount} @everyone',
  });
  await fixture.emit(Events.GuildMemberRemove, fixture.member);
  assert.equal(fixture.sent[0].embeds[0].toJSON().description, `<@${USER}> / Pilot / Garaj / 42 @everyone`);
  assert.deepEqual(fixture.sent[0].allowedMentions, { parse: [], repliedUser: false });
});

test('leave rejects channels outside the guild', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, { leaveEnabled: true, leaveChannelId: CHANNEL });
  fixture.channel.guildId = '1400000000000000999';
  await fixture.emit(Events.GuildMemberRemove, fixture.member);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.store.getLogs(GUILD)[0].type, 'leave.error');
});

test('autorole assigns a valid editable role and logs the assignment', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, { autoRoleEnabled: true, autoRoleId: ROLE });
  await fixture.emit(Events.GuildMemberAdd, fixture.member);
  assert.equal(fixture.assigned.length, 1);
  assert.equal(fixture.assigned[0][0].id, ROLE);
  assert.equal(fixture.store.getLogs(GUILD)[0].type, 'autorole.assigned');
});

for (const [label, mutate] of [
  ['managed role', (fixture) => { fixture.role.managed = true; }],
  ['everyone role', (fixture) => { fixture.role.id = GUILD; }],
  ['hierarchy violation', (fixture) => { fixture.role.editable = false; }],
  ['missing ManageRoles', (fixture) => { fixture.guild.members.me.permissions = new PermissionsBitField(0n); }],
  ['missing role', (fixture) => { fixture.guild.roles.fetch = async () => null; }],
]) {
  test(`autorole rejects ${label}`, async (t) => {
    const fixture = setup(t);
    fixture.store.updateSettings(GUILD, { autoRoleEnabled: true, autoRoleId: ROLE });
    mutate(fixture);
    await fixture.emit(Events.GuildMemberAdd, fixture.member);
    assert.equal(fixture.assigned.length, 0);
    assert.equal(fixture.store.getLogs(GUILD)[0].type, 'autorole.error');
  });
}

test('responders match exact Turkish commands and publish configured reply without mentions', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, {
    responderEnabled: true, responses: [{ trigger: 'yarış', reply: '@everyone Merhaba!' }],
  });
  await fixture.emit(Events.MessageCreate, incoming(fixture, '!YARIŞ'));
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].embeds[0].toJSON().description, '@everyone Merhaba!');
  assert.deepEqual(fixture.sent[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(fixture.store.getLogs(GUILD)[0].type, 'responder.sent');
});

test('responders ignore bots, webhooks, DMs and partial/prefix-only command matches', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, { responderEnabled: true, responses: [{ trigger: 'selam', reply: 'Merhaba' }] });
  for (const message of [
    incoming(fixture, '!selam', { author: { id: BOT, bot: true } }),
    incoming(fixture, '!selam', { webhookId: BOT }),
    incoming(fixture, '!selam', { guild: null }),
    incoming(fixture, '!selam bugün'),
    incoming(fixture, '!selam '),
    incoming(fixture, ' !selam'),
    incoming(fixture, 'selam'),
  ]) await fixture.emit(Events.MessageCreate, message);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.store.getLogs(GUILD).length, 0);
});

test('responders enforce user and guild cooldowns and recover after expiry', async (t) => {
  const fixture = setup(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  fixture.store.updateSettings(GUILD, { responderEnabled: true, responses: [{ trigger: 'selam', reply: 'Merhaba' }] });
  await fixture.emit(Events.MessageCreate, incoming(fixture));
  await fixture.emit(Events.MessageCreate, incoming(fixture));
  await fixture.emit(Events.MessageCreate, incoming(fixture, '!selam', { author: { id: '1400000000000000099', bot: false } }));
  assert.equal(fixture.sent.length, 1);
  now += 1100;
  await fixture.emit(Events.MessageCreate, incoming(fixture));
  assert.equal(fixture.sent.length, 1);
  now += 4000;
  await fixture.emit(Events.MessageCreate, incoming(fixture));
  assert.equal(fixture.sent.length, 2);
});

test('message edits do not create logs and unavailable deletion actors are not guessed', async (t) => {
  const fixture = setup(t);
  const secretContent = 'This message body must never be stored';
  const previous = incoming(fixture, secretContent, { editedTimestamp: null });
  const current = incoming(fixture, `${secretContent} changed`, { editedTimestamp: Date.now() });
  await fixture.emit(Events.MessageUpdate, previous, current);
  await fixture.emit(Events.MessageDelete, previous);
  await fixture.emit(Events.MessageBulkDelete, new Collection([[previous.id, previous]]), fixture.channel);
  const logs = fixture.store.getLogs(GUILD);
  assert.deepEqual(logs.map(({ type }) => type), ['message.bulk_delete', 'message.delete']);
  assert.equal(logs[1].actorId, null);
  assert.equal(logs[1].details.authorId, USER);
  assert.equal(JSON.stringify(logs).includes(secretContent), false);
});

test('embed-only updates do not produce false edit logs', async (t) => {
  const fixture = setup(t);
  await fixture.emit(Events.MessageUpdate, incoming(fixture), incoming(fixture));
  assert.equal(fixture.store.getLogs(GUILD).length, 0);
});

test('member role and timeout changes record metadata without attributing an unknown moderator', async (t) => {
  const fixture = setup(t);
  const previous = { ...fixture.member, communicationDisabledUntilTimestamp: null };
  const current = {
    ...fixture.member,
    roles: { cache: new Collection([[ROLE, { id: ROLE }]]) },
    communicationDisabledUntilTimestamp: Date.now() + 60_000,
  };
  await fixture.emit(Events.GuildMemberUpdate, previous, current);
  const logs = fixture.store.getLogs(GUILD);
  assert.deepEqual(logs.map(({ type }) => type), ['member.timeout_update', 'member.roles_update']);
  assert.deepEqual(logs[1].details.addedRoles, [ROLE]);
  assert.equal(logs[1].actorId, null);
});

test('Discord failures are contained and logged without raw request or error messages', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, { autoRoleEnabled: true, autoRoleId: ROLE });
  fixture.member.roles.add = async () => { throw Object.assign(new Error('secret token ABC'), { code: 50013, requestBody: 'secret' }); };
  await fixture.emit(Events.GuildMemberAdd, fixture.member);
  const logs = fixture.store.getLogs(GUILD);
  assert.equal(logs[0].type, 'community.error');
  assert.equal(logs[0].details.code, 50013);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
  assert.equal(JSON.stringify(fixture.diagnostics).includes('secret'), false);
});

test('optional log channel relays metadata with no mentions and uninstall removes handlers', async (t) => {
  const fixture = setup(t);
  fixture.store.updateSettings(GUILD, { logChannelId: CHANNEL });
  await fixture.emit(Events.GuildMemberAdd, fixture.member);
  assert.equal(fixture.sent.length, 1);
  assert.deepEqual(fixture.sent[0].allowedMentions.parse, []);
  fixture.uninstall();
  assert.equal(fixture.client.eventNames().length, 0);
});
