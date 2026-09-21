import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { createStore } from '../src/store.js';
import { createFeatures } from '../src/features.js';
import { blockedHost, createSpamDetector, extractHosts, parseReminder } from '../src/protection.js';
import { validateGuildSettings } from '../src/dashboard.js';

const G = '1400000000000000000', U = '1400000000000000001', C = '1400000000000000002', R = '1400000000000000003', B = '1400000000000000004';
function fixture(t, { config = {} } = {}) {
  let time = 1000000; const store = createStore(':memory:'), client = new EventEmitter(), sent = [], timeouts = [], deleted = [];
  const user = { id: U, username: 'Pilot', send: async payload => sent.push(payload) };
  const member = { id: U, user, voice: { channelId: 'voice' }, roles: { cache: new Collection() }, permissions: new PermissionsBitField(), moderatable: true, timeout: async (ms, reason) => timeouts.push({ ms, reason }), send: user.send };
  const channel = { id: C, type: ChannelType.GuildText, isTextBased: () => true, permissionsFor: () => new PermissionsBitField(P.ViewChannel), send: user.send };
  const guild = { id: G, name: 'Garaj', members: { cache: new Collection([[U, member]]), fetch: async () => member }, channels: { fetch: async () => channel } };
  client.guilds = { cache: new Collection([[G, guild]]) }; client.users = { cache: new Collection([[U, user]]), fetch: async () => user }; client.user = { id: B }; client.isReady = () => true;
  const features = createFeatures(client, store, config, { now: () => time });
  const message = content => ({ id: String(time), guildId: G, guild, channelId: C, content, member, author: user, attachments: new Collection(), delete: async () => deleted.push(content) });
  t.after(() => { features.close(); store.close(); });
  return { features, store, sent, deleted, timeouts, member, guild, user, channel, client, message, advance: ms => { time += ms; }, now: () => time };
}
test('reminder parser handles Turkish units and rejects impossible times', () => {
  assert.deepEqual(parseReminder('2 saat sonra NFS turnuvası var', 0), { dueAt: 7200000, text: 'NFS turnuvası var' });
  assert.equal(parseReminder('1 GÜN mola', 0).dueAt, 86400000);
  for (const input of ['0 dk yok', '-1 saat yok', '9999999 gün yok', 'yakında oyun', '1 saat']) assert.throws(() => parseReminder(input));
});
test('phishing matching is domain-boundary aware and handles URLs safely', () => {
  const domains = new Set(['bad.test']);
  assert.equal(blockedHost('gift.bad.test', domains), true);
  for (const host of ['notbad.test', 'bad.test.good.com', 'good.test']) assert.equal(blockedHost(host, domains), false);
  assert.deepEqual(extractHosts('https://good.test@bad.test/path <https://GOOD.test/> www.example.com'), ['bad.test', 'good.test', 'www.example.com']);
});
test('five identical messages must be inside 3 seconds and isolated per user/guild', () => {
  let time = 1; const detector = createSpamDetector({ now: () => time });
  for (let i = 0; i < 4; i++) assert.equal(detector.hit('a', 'SPAM'), false);
  assert.equal(detector.hit('b', 'spam'), false); time += 3001;
  assert.equal(detector.hit('a', 'spam'), false);
  for (let i = 0; i < 3; i++) assert.equal(detector.hit('a', 'spam'), false);
  assert.equal(detector.hit('a', 'spam'), true);
});
test('anti phishing deletes matching message and applies exactly 12 hours timeout with audit evidence', async t => {
  const f = fixture(t); f.store.updateSettings(G, { antiPhishingEnabled: true, phishingDomains: ['bad.test'] });
  await f.features.processMessage(f.message('Bedava nitro https://gift.bad.test/claim'));
  assert.equal(f.deleted.length, 1); assert.equal(f.timeouts[0].ms, 12 * 3600000);
  const log = f.store.getLogs(G)[0]; assert.equal(log.type, 'protection.phishing'); assert.equal(log.details.actorName, 'Pilot'); assert.equal(log.details.deleted, true);
  await f.features.processMessage(f.message('https://notbad.test')); assert.equal(f.deleted.length, 1);
});
test('spam timeout only triggers at threshold and skips moderator spam', async t => {
  const f = fixture(t); f.store.updateSettings(G, { antiSpamEnabled: true });
  for (let n = 0; n < 4; n++) await f.features.processMessage(f.message('same'));
  assert.equal(f.timeouts.length, 0); await f.features.processMessage(f.message('same')); assert.equal(f.timeouts.length, 1);
  f.member.permissions = new PermissionsBitField(P.ManageMessages);
  for (let n = 0; n < 10; n++) await f.features.processMessage(f.message('admin'));
  assert.equal(f.timeouts.length, 1);
});
test('moderation hierarchy failure is accurately logged instead of claiming timeout', async t => {
  const f = fixture(t); f.member.moderatable = false; f.store.updateSettings(G, { antiPhishingEnabled: true, phishingDomains: ['bad.test'] });
  await f.features.processMessage(f.message('https://bad.test')); assert.equal(f.timeouts.length, 0); assert.equal(f.store.getLogs(G)[0].details.timedOut, false);
});
test('durable reminders deliver once on subsequent ticks and only mention intended member', async t => {
  const f = fixture(t);
  f.store.putRecord(G, 'reminder', 'one', { userId: U, channelId: C, text: '@everyone NFS', dueAt: f.now() + 1000, destination: 'channel', status: 'pending', attempts: 0 });
  await f.features.tick(); assert.equal(f.sent.length, 0); f.advance(1000); await f.features.tick(); await f.features.tick();
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: [U] }); assert.equal(f.store.getRecord(G, 'reminder', 'one').status, 'sent');
});
test('failed reminder delivery retries finitely and keeps a visible failed state', async t => {
  const f = fixture(t); f.member.send = async () => { throw new Error('DM closed'); };
  f.store.putRecord(G, 'reminder', 'one', { userId: U, text: 'Private note', dueAt: f.now(), destination: 'dm', status: 'pending', attempts: 0, createdAt: f.now() });
  for (let n = 0; n < 3; n++) { await f.features.tick(); f.advance(60000); }
  assert.equal(f.store.getRecord(G, 'reminder', 'one').status, 'failed'); assert.equal(f.store.getLogs(G)[0].type, 'reminder.failed');
});
test('health reminders require opt-in and reset on loss of voice activity', async t => {
  const f = fixture(t); f.store.putRecord(G, 'health', U, { enabled: true, destination: 'dm' });
  await f.features.tick(); f.advance(2 * 3600000); await f.features.tick(); assert.equal(f.sent.length, 0);
  f.member.voice.channelId = null; await f.features.tick(); f.member.voice.channelId = 'voice'; await f.features.tick(); f.advance(3600000); await f.features.tick(); assert.equal(f.sent.length, 0);
  f.advance(2 * 3600000); await f.features.tick(); assert.equal(f.sent.length, 1);
  f.store.putRecord(G, 'health', U, { enabled: false }); f.advance(4 * 3600000); await f.features.tick(); assert.equal(f.sent.length, 1);
});
test('multiple autoroles retain backward compatibility and cannot clear enabled roles', t => {
  const f = fixture(t); f.store.updateSettings(G, { autoRoleId: R, autoRoleEnabled: true }); assert.deepEqual(f.store.getSettings(G).autoRoleIds, [R]);
  f.store.updateSettings(G, { autoRoleIds: [R, C, R] }); assert.deepEqual(f.store.getSettings(G).autoRoleIds, [R, C]);
  assert.throws(() => f.store.updateSettings(G, { autoRoleIds: [] }));
  assert.deepEqual(f.store.getSettings(G).autoRoleIds, [R, C]);
});

test('panel login code is sent in a Discord copyable code block', async t => {
  const f = fixture(t, { config: { publicUrl: 'https://pit-stop.example.com', panelOrigins: ['https://pit-stop.example.com', 'https://pit-stop-fallback.example.com', 'https://safe-tunnel.trycloudflare.com'] } });
  const command = f.features.commands.find(item => item.data.toJSON().name === 'panel-giris');
  f.member.permissions = new PermissionsBitField(P.ManageGuild);
  let reply;
  await command.execute({
    guildId: G, user: f.user, member: f.member,
    reply: async payload => { reply = payload; }, deleteReply: async () => {},
  });
  assert.match(reply.content, /Pit-Stop giriş kodunuz:\n\n```\n[A-Za-z0-9_-]{43}\n```/u);
  assert.match(reply.content, /sağındaki kopyalama düğmesini/u);
  assert.match(reply.content, /Panel: <https:\/\/pit-stop\.example\.com>/u);
  assert.match(reply.content, /GoodbyDPI yedek giriş: <https:\/\/pit-stop-fallback\.example\.com>/u);
  assert.match(reply.content, /Cloudflare yedek giriş: <https:\/\/safe-tunnel\.trycloudflare\.com>/u);
  assert.equal(f.store.listRecords(G, 'panel_login_code').length, 1);
});
test('every autorole is validated against actor and bot hierarchy', async () => {
  const guild = { id: G, ownerId: B, roles: { fetch: async id => ({ id, managed: false, editable: id === R }) } };
  const member = { id: U, permissions: new PermissionsBitField(P.ManageRoles), roles: { highest: { comparePositionTo: () => 1 } } };
  await assert.rejects(validateGuildSettings(guild, member, { autoRoleIds: [R, C] }), /yönetebileceği/);
});
test('ticket creation isolates permissions and deduplicates concurrent requests', async t => {
  const f = fixture(t); f.store.updateSettings(G, { ticketEnabled: true, ticketChannelId: C, supportRoleId: R });
  let created = [];
  f.guild.channels.create = async options => { created.push(options); return { id: C, send: async () => {} }; };
  f.features.install();
  const replies = [], interaction = { customId: 'ticket:create', guild: f.guild, guildId: G, user: f.user, isButton: () => true, deferReply: async () => {}, editReply: async text => replies.push(text) };
  const emit = () => Promise.all(f.client.listeners('interactionCreate').map(fn => fn(interaction)));
  await Promise.all([emit(), emit()]); assert.equal(created.length, 1);
  assert.deepEqual(created[0].permissionOverwrites[0], { id: G, deny: [P.ViewChannel] });
  assert.deepEqual(created[0].permissionOverwrites.map(p => p.id), [G, U, R, B]);
});
test('ticket close button lets only the ticket owner or support staff close once', async t => {
  const f = fixture(t), edits = [];
  const ticketChannel = { id: C, permissionOverwrites: { edit: async (...args) => edits.push(args) } };
  f.store.putRecord(G, 'ticket', C, { userId: U, name: 'Pilot', createdAt: f.now(), status: 'open' });
  f.features.install();
  const replies = [];
  const interaction = { customId: 'ticket:close', guildId: G, channel: ticketChannel, channelId: C, user: f.user, member: f.member, isButton: () => true, deferReply: async () => {}, editReply: async text => replies.push(text) };
  await Promise.all(f.client.listeners('interactionCreate').map(fn => fn(interaction)));
  assert.equal(f.store.getRecord(G, 'ticket', C).status, 'closed');
  assert.deepEqual(edits, [[U, { SendMessages: false }]]);
  assert.match(replies[0], /Talep kapatıldı/);
  await Promise.all(f.client.listeners('interactionCreate').map(fn => fn(interaction)));
  assert.match(replies[1], /zaten kapalı/);
});
test('ticket delete button requires staff and Manage Channels permission', async t => {
  const f = fixture(t), deleted = [];
  const ticketChannel = { id: C, delete: async reason => deleted.push(reason) };
  f.store.putRecord(G, 'ticket', C, { userId: U, name: 'Pilot', createdAt: f.now(), status: 'open' });
  f.features.install();
  const replies = [];
  const interaction = { customId: 'ticket:delete', guildId: G, channel: ticketChannel, channelId: C, user: f.user, member: f.member, isButton: () => true, deferReply: async () => {}, editReply: async text => replies.push(text) };
  await Promise.all(f.client.listeners('interactionCreate').map(fn => fn(interaction)));
  assert.equal(deleted.length, 0);
  assert.match(replies[0], /yalnızca Kanalları Yönet/);
  f.member.permissions = new PermissionsBitField(P.ManageGuild | P.ManageChannels);
  await Promise.all(f.client.listeners('interactionCreate').map(fn => fn(interaction)));
  assert.equal(deleted.length, 1);
  assert.equal(f.store.getRecord(G, 'ticket', C).status, 'deleted');
  assert.equal(f.store.getLogs(G)[0].type, 'ticket.deleted');
});
test('FAQ publishing requires a manager and records the Discord message', async t => {
  const f = fixture(t), messages = [];
  f.store.updateSettings(G, { faqEnabled: true, faqChannelId: C });
  f.channel.send = async payload => { messages.push(payload); return { id: 'message-1' }; };
  await assert.rejects(f.features.publishFaq(f.guild, f.member, f.user, 'Nasıl katılırım?', 'Duyuru bağlantısını kullan.'), /Sunucuyu Yönet/);
  f.member.permissions = new PermissionsBitField(P.ManageGuild);
  const item = await f.features.publishFaq(f.guild, f.member, f.user, 'Nasıl katılırım?', 'Duyuru bağlantısını kullan.');
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(item.messageId, 'message-1');
  assert.equal(f.store.getLogs(G)[0].type, 'faq.published');
});
test('health command uses an ASCII name and support-role ticket close remains visible', t => {
  const f = fixture(t), definitions = Object.fromEntries(f.features.commands.map(item => [item.data.toJSON().name, item.data.toJSON()]));
  assert.ok(definitions.healthcare);
  assert.equal(definitions['sağlık-asistanı'], undefined);
  assert.equal(definitions['bilet-kapat'].default_member_permissions, undefined);
});
test('defense form rejects a different user before opening a modal', async t => {
  const f = fixture(t); f.store.putRecord(G, 'case', C, { userId: B, status: 'open' }); f.features.install();
  let reply, shown = false;
  const i = { customId: `defense:${G}:${C}`, user: f.user, isButton: () => true, reply: async p => { reply = p; }, showModal: async () => { shown = true; } };
  await Promise.all(f.client.listeners('interactionCreate').map(fn => fn(i))); assert.equal(shown, false); assert.match(reply.content, /erişiminiz yok/);
});
