import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { createDashboard, validateGuildSettings } from '../src/dashboard.js';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';
const USER = '1400000000000000001';
const ROLE = '1400000000000000002';
const CHANNEL = '1400000000000000003';
const BOT = '1400000000000000004';
const OTHER_GUILD = '1400000000000000005';
const PUBLIC_ORIGIN = 'https://pit-stop.example';
const SECRETS = ['BOT_TOKEN_TEST_abc', 'OAUTH_SECRET_TEST_abc', 'SESSION_SECRET_TEST_abcdefghijklmnopqrstuvwxyz', 'ACCESS_TOKEN_TEST_abc'];
const adminPermissions = PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles
  | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory
  | PermissionFlagsBits.AddReactions | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ManageChannels;

async function setup(t, configOverrides = {}) {
  const store = createStore(':memory:');
  const calls = { discord: [], music: [], settings: [], memberFetches: [], diagnostics: [], crew: [], ticketCloses: [], ticketDeletes: [], reactionMessages: [], reactions: [] };
  const member = {
    id: USER, permissions: new PermissionsBitField(adminPermissions),
    user: { id: USER, username: 'pilot', globalName: 'Pilot', avatar: null },
    roles: { cache: new Collection([[ROLE, { id: ROLE }]]), highest: { comparePositionTo: (role) => 10 - role.position } },
  };
  const botMember = { id: BOT, permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) };
  const role = { id: ROLE, name: 'Üye', position: 2, editable: true, managed: false, hexColor: '#ff4400' };
  const channel = {
    id: CHANNEL, guildId: GUILD, name: 'genel', type: ChannelType.GuildText,
    permissionsFor: () => new PermissionsBitField(adminPermissions),
  };
  const sentMessages = new Collection();
  channel.send = async payload => {
    const message = { id: `14000000000000001${sentMessages.size}`, channelId: CHANNEL, payload, react: async emoji => { calls.reactions.push(emoji); }, delete: async () => { sentMessages.delete(message.id); } };
    sentMessages.set(message.id, message); calls.reactionMessages.push(payload); return message;
  };
  channel.messages = { fetch: async id => sentMessages.get(id) };
  const channels = new Collection([[CHANNEL, channel]]);
  const roles = new Collection([[ROLE, role]]);
  const guild = {
    id: GUILD, name: 'Garaj', ownerId: '1400000000000000999', memberCount: 42,
    iconURL: () => null,
    channels: { cache: channels, fetch: async (id) => id ? channels.get(id) : channels },
    roles: { cache: roles, fetch: async (id) => id ? roles.get(id) : roles },
    emojis: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      me: botMember,
      fetch: async (options) => { calls.memberFetches.push(options); return member; },
    },
  };
  channel.guild = guild;
  role.guild = guild;
  const forbiddenGuild = {
    ...guild, id: OTHER_GUILD,
    members: { me: botMember, fetch: async () => ({ ...member, permissions: new PermissionsBitField(0n) }) },
  };
  const client = {
    guilds: { cache: new Collection([[GUILD, guild], [OTHER_GUILD, forbiddenGuild]]) },
    isReady: () => true, ws: { ping: 35 },
  };
  const music = {
    getStatus: () => ({ available: true, connected: false, volume: 50, current: null, queue: [], spotifyConfigured: false }),
    control: async (...args) => { calls.music.push(args); },
    applySettings: async (...args) => { calls.settings.push(args); },
  };
  const features = {
    protectionStatus: () => ({}),
    publishTicket: async () => {},
    closeTicket: async (guildId, ticketChannel, actor) => {
      calls.ticketCloses.push({ guildId, channelId: ticketChannel.id, actorId: actor.id });
      const item = store.getRecord(guildId, 'ticket', ticketChannel.id);
      store.putRecord(guildId, 'ticket', ticketChannel.id, { ...item, status: 'closed', closedBy: actor.id, closedAt: Date.now() });
    },
    deleteTicket: async (guildId, ticketChannel, actor) => {
      calls.ticketDeletes.push({ guildId, channelId: ticketChannel.id, actorId: actor.id });
      const item = store.getRecord(guildId, 'ticket', ticketChannel.id);
      store.putRecord(guildId, 'ticket', ticketChannel.id, { ...item, status: 'deleted', deletedBy: actor.id, deletedAt: Date.now() });
    },
  };
  const crew = {
    getStatus: guildId => ({ enabled: true, crewId: 1636, guildId, members: [{ name: 'Pilot', crewRep: 100 }] }),
    refresh: async (...args) => { calls.crew.push(args); return { enabled: true, crewId: 1636, members: [{ name: 'Pilot', crewRep: 125 }] }; },
  };
  const config = {
    publicUrl: PUBLIC_ORIGIN,
    clientId: BOT,
    token: SECRETS[0],
    clientSecret: SECRETS[1],
    sessionSecret: SECRETS[2],
    ...configOverrides,
  };
  const fetcher = async (url, options) => {
    calls.discord.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path === '/api/v10/oauth2/token') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('client_secret'), SECRETS[1]);
      return Response.json({ access_token: SECRETS[3], expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, `Bearer ${SECRETS[3]}`);
    if (path === '/api/v10/users/@me') {
      return Response.json({ id: USER, username: 'pilot', global_name: 'Pilot', avatar: null, internal: 'not public' });
    }
    if (path === '/api/v10/users/@me/guilds') {
      return Response.json([
        { id: GUILD, name: guild.name, icon: null, permissions: PermissionFlagsBits.ManageGuild.toString() },
        { id: OTHER_GUILD, name: 'İzinsiz', icon: null, permissions: '0' },
        { id: '1400000000000000777', name: 'Bot yok', icon: null, permissions: PermissionFlagsBits.Administrator.toString() },
      ]);
    }
    throw new Error(`Unexpected mocked Discord request: ${path}`);
  };
  const server = createDashboard({ client, store, music, features, crew, config, fetcher, logger: (...args) => calls.diagnostics.push(args) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    store.close();
  });

  const request = (path, options = {}) => fetch(`${origin}${path}`, { redirect: 'manual', ...options });
  async function beginLogin(interactive = false) {
    const response = await request(interactive ? '/auth/login?interactive=1' : '/auth/login');
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location'));
    const stateCookie = response.headers.getSetCookie().find((value) => value.startsWith('pitstop_state='));
    return { response, target, state: target.searchParams.get('state'), cookie: stateCookie.split(';')[0] };
  }
  async function login() {
    const initial = await beginLogin();
    const callback = await request(`/auth/callback?code=fake-authorization-code&state=${encodeURIComponent(initial.state)}`, {
      headers: { Cookie: initial.cookie },
    });
    assert.equal(callback.status, 303);
    const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith('pitstop_session='));
    assert.ok(sessionCookie);
    const cookie = sessionCookie.split(';')[0];
    const me = await request('/api/me', { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const body = await me.json();
    return { ...initial, callback, cookie, sessionCookie, csrf: body.csrf, me: body };
  }
  const mutation = (path, session, body, headers = {}) => request(path, {
    method: 'PUT',
    headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { request, beginLogin, login, mutation, store, calls, guild, member, role, channel, config, music, features, crew, client, fetcher };
}

function noSecrets(value) {
  for (const secret of SECRETS) assert.equal(value.includes(secret), false, 'A private credential was exposed');
}

test('RPG dashboard requires guild access and returns scoped ranking, catalog and actual commands', async t => {
  const fixture = await setup(t);
  const path = `/api/guilds/${GUILD}/rpg`;
  assert.equal((await fixture.request(path)).status, 401);
  const session = await fixture.login();
  const headers = { Cookie: session.cookie };
  const player = { name: 'Pilot', xp: 40, coins: 1000, wins: 1, losses: 0, sword: 'demir-kilic', armor: null, receipts: ['private'], cooldowns: { work: 123 }, garage: { xp: 250 } };
  fixture.store.putRecord(GUILD, 'rpg_player', USER, player);
  fixture.store.putRecord(GUILD, 'rpg_player', ROLE, { ...player, name: 'Champion', xp: 400 });
  fixture.store.putRecord(OTHER_GUILD, 'rpg_player', USER, { ...player, name: 'Other server', xp: 99999 });
  const response = await fixture.request(path, { headers });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.leaderboard.map(p => p.name), ['Champion', 'Pilot']);
  assert.equal(data.leaderboard[0].level, 3);
  assert.equal(data.leaderboard[0].sword, 'Demir kılıç');
  assert.equal(data.items.length, 56);
  assert.equal(data.monsters.length, 6);
  assert.equal(data.commands.length, 48);
  assert.equal(data.classes.length, 3);
  assert.equal(data.recipes.length, 9);
  assert.equal(data.world.timezone, 'Europe/Istanbul');
  assert.equal(data.garage.level, 2);
  assert.ok(data.commands.some(c => c.usage === '/rpg-rehber'));
  assert.ok(!JSON.stringify(data).includes('receipts'));
  assert.ok(!JSON.stringify(data).includes('cooldowns'));
  const garageResponse = await fixture.request(`${path}/garage/action`, {
    method: 'POST',
    headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'garage_buy_test', action: 'garageBuy', upgradeId: 'krom-set' }),
  });
  assert.equal(garageResponse.status, 200);
  assert.ok((await garageResponse.json()).state.garage.upgrades.find(item => item.id === 'krom-set').readyAt);
  assert.equal((await fixture.request(`/api/guilds/${OTHER_GUILD}/rpg`, { headers })).status, 403);
});

test('RPG announcement channel changes use protected settings and validate guild ownership', async t => {
  const fixture = await setup(t), session = await fixture.login();
  const path = `/api/guilds/${GUILD}/settings`;
  assert.equal((await fixture.mutation(path, session, { rpgAnnouncementChannelId: CHANNEL })).status, 200);
  assert.equal(fixture.store.getSettings(GUILD).rpgAnnouncementChannelId, CHANNEL);
  assert.equal((await fixture.mutation(path, session, { rpgAnnouncementChannelId: OTHER_GUILD })).status, 400);
  assert.equal(fixture.store.getSettings(GUILD).rpgAnnouncementChannelId, CHANNEL);
  assert.equal((await fixture.mutation(path, session, { rpgAnnouncementChannelId: null }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await fixture.request('/rpg-view.js')).status, 200);
  assert.equal((await fixture.request('/rpg-garage-scene.js')).status, 200);
});

test('OAuth HTTP flow issues protected state/session cookies and attempts silent reuse first', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  assert.equal(session.target.origin, 'https://discord.com');
  assert.equal(session.target.searchParams.get('scope'), 'identify guilds');
  assert.equal(session.target.searchParams.get('redirect_uri'), `${PUBLIC_ORIGIN}/auth/callback`);
  assert.equal(session.target.searchParams.get('prompt'), 'none');
  assert.ok(session.state.length >= 32);
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(session.sessionCookie.includes(attribute));
  assert.match(session.sessionCookie, /Max-Age=28800/u);
  assert.deepEqual(Object.keys(session.me).sort(), ['csrf', 'installationOwner', 'user']);
  assert.equal(session.me.user.id, USER);
  noSecrets(JSON.stringify(session.me));
  const saved = fixture.store.listRecords(BOT, 'panel_session');
  assert.equal(saved.length, 1);
  noSecrets(JSON.stringify(saved));
});

test('one-time Discord codes create one hashed session and cannot be replayed', async (t) => {
  const fixture = await setup(t);
  const code = 'A'.repeat(43), hash = createHash('sha256').update(code).digest('hex');
  fixture.store.putRecord(GUILD, 'panel_login_code', hash, { userId: USER, userName: 'Pilot', createdAt: Date.now(), expiresAt: Date.now() + 120_000 });
  const first = await fixture.request('/auth/code', { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(first.status, 200);
  const sessionCookie = first.headers.getSetCookie().find(value => value.startsWith('pitstop_session='));
  assert.match(sessionCookie, /Max-Age=28800/u);
  const cookie = sessionCookie.split(';')[0];
  assert.equal((await fixture.request('/api/me', { headers: { Cookie: cookie } })).status, 200);
  assert.equal(fixture.store.listRecords(GUILD, 'panel_login_code').length, 0);
  assert.equal(JSON.stringify(fixture.store.listRecords(BOT, 'panel_session')).includes(code), false);
  const replay = await fixture.request('/auth/code', { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(replay.status, 401);
});

test('encrypted panel sessions survive a dashboard restart', async t => {
  const fixture = await setup(t), session = await fixture.login();
  const restarted = createDashboard({ client: fixture.client, store: fixture.store, music: fixture.music, features: fixture.features, crew: fixture.crew, config: fixture.config, fetcher: fixture.fetcher });
  restarted.listen(0, '127.0.0.1'); await once(restarted, 'listening');
  const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/me`, { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, USER);
  const closed = once(restarted, 'close'); restarted.close(); restarted.closeAllConnections(); await closed;
});

test('OAuth states cannot be replayed after a successful callback', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  const previousRequests = fixture.calls.discord.length;
  const replay = await fixture.request(`/auth/callback?state=${session.state}&code=another-code`, {
    headers: { Cookie: `pitstop_state=${session.state}` },
  });
  assert.equal(replay.status, 400);
  assert.equal(fixture.calls.discord.length, previousRequests);
});

test('OAuth callback rejects absent or mismatched browser state before exchanging credentials', async (t) => {
  const fixture = await setup(t);
  for (const cookie of [undefined, 'pitstop_state=wrong-state']) {
    const initial = await fixture.beginLogin();
    const response = await fixture.request(`/auth/callback?state=${initial.state}&code=fake-code`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    assert.equal(response.status, 400);
  }
  assert.equal(fixture.calls.discord.length, 0);
});

test('OAuth denial creates no session and consumes the state', async (t) => {
  const fixture = await setup(t);
  const initial = await fixture.beginLogin();
  const response = await fixture.request(`/auth/callback?state=${initial.state}&error=access_denied`, { headers: { Cookie: initial.cookie } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/auth/login?interactive=1');
  const interactive = await fixture.beginLogin(true);
  const cancelled = await fixture.request(`/auth/callback?state=${interactive.state}&error=access_denied`, { headers: { Cookie: interactive.cookie } });
  assert.equal(cancelled.status, 303);
  assert.equal(cancelled.headers.get('location'), '/?login=cancelled');
  assert.equal(response.headers.getSetCookie().some((value) => value.startsWith('pitstop_session=')), false);
  assert.equal(fixture.calls.discord.length, 0);
});

test('settings writes require both the session CSRF token and the configured origin', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  for (const headers of [
    { 'X-CSRF-Token': '' },
    { 'X-CSRF-Token': 'incorrect' },
    { Origin: 'https://attacker.example' },
    { Origin: '' },
  ]) {
    const response = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { musicVolume: 77 }, headers);
    assert.equal(response.status, 403);
  }
  assert.equal(fixture.store.getSettings(GUILD).musicVolume, 50);
  assert.equal(fixture.store.getLogs(GUILD).length, 0);
  const valid = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { musicVolume: 77 });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).musicVolume, 77);
  assert.equal(fixture.store.getLogs(GUILD)[0].actorId, USER);
});

test('code and protected requests accept an explicitly configured fallback panel origin', async t => {
  const fallback = 'https://pit-stop-fallback.example';
  const fixture = await setup(t, { panelOrigins: [PUBLIC_ORIGIN, fallback] });
  const session = await fixture.login();
  const response = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { musicVolume: 68 }, { Origin: fallback });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).musicVolume, 68);
  const rejected = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { musicVolume: 69 }, { Origin: 'https://unknown.example' });
  assert.equal(rejected.status, 403);
});

test('crew dashboard reads current comparisons and triggers a protected refresh', async t => {
  const fixture = await setup(t), session = await fixture.login();
  const current = await fixture.request(`/api/guilds/${GUILD}/crew`, { headers: { Cookie: session.cookie } });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).members[0].crewRep, 100);
  const refreshed = await fixture.request(`/api/guilds/${GUILD}/crew`, { method: 'POST', headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).members[0].crewRep, 125);
  assert.deepEqual(fixture.calls.crew, [[GUILD, true, { log: true, actorId: USER, actorName: 'Pilot' }]]);
});

test('panel ticket close uses the same audited close path as Discord', async t => {
  const fixture = await setup(t), session = await fixture.login();
  fixture.store.putRecord(GUILD, 'ticket', CHANNEL, { userId: USER, status: 'open', createdAt: Date.now() });
  const response = await fixture.request(`/api/guilds/${GUILD}/tickets`, { method: 'DELETE', headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: CHANNEL }) });
  assert.equal(response.status, 200);
  assert.equal(fixture.store.getRecord(GUILD, 'ticket', CHANNEL).status, 'closed');
  assert.deepEqual(fixture.calls.ticketCloses, [{ guildId: GUILD, channelId: CHANNEL, actorId: USER }]);
});

test('panel ticket channel deletion is routed through the staff-only feature guard', async t => {
  const fixture = await setup(t), session = await fixture.login();
  fixture.store.putRecord(GUILD, 'ticket', CHANNEL, { userId: USER, status: 'closed', createdAt: Date.now() });
  const response = await fixture.request(`/api/guilds/${GUILD}/tickets`, { method: 'DELETE', headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: CHANNEL, action: 'delete' }) });
  assert.equal(response.status, 200);
  assert.equal(fixture.store.getRecord(GUILD, 'ticket', CHANNEL).status, 'deleted');
  assert.deepEqual(fixture.calls.ticketDeletes, [{ guildId: GUILD, channelId: CHANNEL, actorId: USER }]);
});

test('published FAQ records can be edited and update their Discord message', async t => {
  const fixture = await setup(t), session = await fixture.login(), edits = [];
  fixture.store.putRecord(GUILD, 'faq', 'faq-one', { question: 'Eski soru', answer: 'Eski cevap', status: 'published', channelId: CHANNEL, messageId: '1400000000000000010', createdAt: Date.now() });
  fixture.channel.messages = { fetch: async () => ({ edit: async payload => edits.push(payload) }) };
  const response = await fixture.mutation(`/api/guilds/${GUILD}/faqs`, session, { id: 'faq-one', question: 'Yeni soru', answer: 'Yeni cevap' });
  assert.equal(response.status, 200);
  assert.equal(fixture.store.getRecord(GUILD, 'faq', 'faq-one').question, 'Yeni soru');
  assert.deepEqual(edits, [{ content: '❓ **Yeni soru**\nYeni cevap', allowedMentions: { parse: [] } }]);
  assert.equal(fixture.store.getLogs(GUILD, { type: 'faq.updated' })[0].actorId, USER);
});

test('legacy FAQ duplicates can update their own Discord message without a false duplicate error', async t => {
  const fixture = await setup(t), session = await fixture.login(), edits = [];
  fixture.store.putRecord(GUILD, 'faq', 'legacy-one', { question: 'Aynı eski soru', answer: 'İlk cevap', channelId: CHANNEL, messageId: '1400000000000000011', createdAt: Date.now() - 1000 });
  fixture.store.putRecord(GUILD, 'faq', 'legacy-two', { question: 'Aynı eski soru', answer: 'Diğer cevap', status: 'published', channelId: CHANNEL, messageId: '1400000000000000012', createdAt: Date.now() });
  fixture.channel.messages = { fetch: async id => id === '1400000000000000011' ? { edit: async payload => edits.push(payload) } : null };
  const response = await fixture.mutation(`/api/guilds/${GUILD}/faqs`, session, { id: 'legacy-one', question: 'Aynı eski soru', answer: 'Güncel cevap' });
  assert.equal(response.status, 200);
  assert.equal(fixture.store.getRecord(GUILD, 'faq', 'legacy-one').status, 'published');
  assert.equal(fixture.store.getRecord(GUILD, 'faq', 'legacy-one').answer, 'Güncel cevap');
  assert.deepEqual(edits, [{ content: '❓ **Aynı eski soru**\nGüncel cevap', allowedMentions: { parse: [] } }]);
});

test('panel publishes and removes a guarded emoji role message', async t => {
  const fixture = await setup(t), session = await fixture.login();
  const headers = { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' };
  const published = await fixture.request(`/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: CHANNEL, content: 'Rolünüzü seçin.', mappings: [{ emoji: 'unicode:🏁', roleId: ROLE }] }),
  });
  assert.equal(published.status, 200);
  const record = await published.json();
  assert.equal(record.mappings[0].roleName, 'Üye');
  assert.deepEqual(fixture.calls.reactionMessages, [{ content: 'Rolünüzü seçin.', allowedMentions: { parse: [] } }]);
  assert.deepEqual(fixture.calls.reactions, ['🏁']);
  assert.equal(fixture.store.getRecord(GUILD, 'reaction_role', record.id).createdBy, USER);

  const removed = await fixture.request(`/api/guilds/${GUILD}/reaction-roles`, { method: 'DELETE', headers, body: JSON.stringify({ id: record.id }) });
  assert.equal(removed.status, 200);
  assert.equal(fixture.store.getRecord(GUILD, 'reaction_role', record.id), null);
  assert.deepEqual(fixture.store.getLogs(GUILD, { limit: 10 }).slice(0, 2).map(log => log.type), ['reaction_role.deleted', 'reaction_role.published']);
});

test('unauthenticated APIs and tampered session cookies are rejected', async (t) => {
  const fixture = await setup(t);
  for (const path of ['/api/me', '/api/guilds', `/api/guilds/${GUILD}`, `/api/guilds/${GUILD}/logs`]) {
    assert.equal((await fixture.request(path)).status, 401);
  }
  const session = await fixture.login();
  const forged = session.cookie.replace(/.$/u, session.cookie.endsWith('a') ? 'b' : 'a');
  assert.equal((await fixture.request('/api/me', { headers: { Cookie: forged } })).status, 401);
});

test('guild listing excludes unmanageable guilds and guilds without the bot', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  const response = await fixture.request('/api/guilds', { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(({ id }) => id), [GUILD]);
});

test('guild authorization is enforced for reads and writes independently of OAuth guild listing', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  for (const resource of ['', '/logs', '/music']) {
    const response = await fixture.request(`/api/guilds/${OTHER_GUILD}${resource}`, { headers: { Cookie: session.cookie } });
    assert.equal(response.status, 403);
  }
  const forbidden = await fixture.mutation(`/api/guilds/${OTHER_GUILD}/settings`, session, { musicEnabled: true });
  assert.equal(forbidden.status, 403);
  assert.equal(fixture.store.getSettings(OTHER_GUILD).musicEnabled, false);
  const missing = await fixture.request('/api/guilds/1400000000000000888', { headers: { Cookie: session.cookie } });
  assert.equal(missing.status, 404);
});

test('removing ManageGuild revokes access immediately even with an existing login', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  const first = await fixture.request(`/api/guilds/${GUILD}`, { headers: { Cookie: session.cookie } });
  assert.equal(first.status, 200);
  const dashboard = (await first.json()).dashboard;
  assert.equal(dashboard.onlineCount, 0);
  assert.equal(dashboard.voiceMemberCount, 0);
  assert.equal(dashboard.todayMessages, 0);
  assert.equal(dashboard.series.length, 24);
  assert.equal(dashboard.changePercent, null);
  fixture.member.permissions = new PermissionsBitField(0n);
  const revoked = await fixture.request(`/api/guilds/${GUILD}/logs`, { headers: { Cookie: session.cookie } });
  assert.equal(revoked.status, 403);
  assert.ok(fixture.calls.memberFetches.every((options) => options.force === true && options.user === USER));
});

test('autorole settings require member permission and role hierarchy', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  fixture.member.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
  const noPermission = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { autoRoleId: ROLE });
  assert.equal(noPermission.status, 400);
  fixture.member.permissions = new PermissionsBitField(adminPermissions);
  fixture.role.position = 11;
  const tooHigh = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { autoRoleId: ROLE });
  assert.equal(tooHigh.status, 400);
  fixture.role.position = 2;
  fixture.role.managed = true;
  const managed = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { autoRoleId: ROLE });
  assert.equal(managed.status, 400);
  assert.equal(fixture.store.getSettings(GUILD).autoRoleId, null);
});

test('enabling a saved autorole rechecks permission even when the patch omits autoRoleId', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  fixture.store.updateSettings(GUILD, { autoRoleId: ROLE, autoRoleEnabled: false });
  fixture.member.permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
  const response = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { autoRoleEnabled: true });
  assert.ok([400, 403].includes(response.status), `Expected denial, got ${response.status}`);
  assert.equal(fixture.store.getSettings(GUILD).autoRoleEnabled, false);
});

test('channel validation rejects another guild and prevents hidden-channel writes', async (t) => {
  const fixture = await setup(t);
  fixture.channel.guildId = OTHER_GUILD;
  await assert.rejects(() => validateGuildSettings(fixture.guild, fixture.member, { leaveChannelId: CHANNEL }), { status: 400 });
  fixture.channel.guildId = GUILD;
  fixture.channel.permissionsFor = (who) => new PermissionsBitField(who.id === USER ? 0n : adminPermissions);
  await assert.rejects(() => validateGuildSettings(fixture.guild, fixture.member, { logChannelId: CHANNEL }), { status: 400 });
});

test('invalid settings and oversized bodies do not persist', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  const invalid = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { unknownSecret: 'please save', musicVolume: 80 });
  assert.equal(invalid.status, 400);
  const oversized = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { leaveMessage: 'x'.repeat(33_000) });
  assert.equal(oversized.status, 413);
  assert.equal(fixture.store.getSettings(GUILD).musicVolume, 50);
});

test('defense parent rejects announcement channels that cannot host private threads', async (t) => {
  const fixture = await setup(t);
  fixture.channel.type = ChannelType.GuildAnnouncement;
  await assert.rejects(() => validateGuildSettings(fixture.guild, fixture.member, { defenseChannelId: CHANNEL }), { status: 400 });
});

test('settings audit safely records long escaped response changes', async (t) => {
  const fixture = await setup(t), session = await fixture.login();
  for (const reply of ['"'.repeat(1750), '\\'.repeat(1750)]) {
    const response = await fixture.mutation(`/api/guilds/${GUILD}/settings`, session, { responses: [{ trigger: 'test', reply }] });
    assert.equal(response.status, 200);
    assert.equal(fixture.store.getSettings(GUILD).responses[0].reply, reply);
    const detail = fixture.store.getLogs(GUILD, { type: 'settings.detail' })[0];
    assert.ok(JSON.stringify(detail.details).length <= 4000);
    assert.equal(detail.actorId, USER);
  }
});

test('logout requires CSRF and invalidates the server-side session', async (t) => {
  const fixture = await setup(t);
  const session = await fixture.login();
  const denied = await fixture.request('/auth/logout', { method: 'POST', headers: { Cookie: session.cookie } });
  assert.equal(denied.status, 403);
  const valid = await fixture.request('/auth/logout', {
    method: 'POST', headers: { Cookie: session.cookie, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': session.csrf },
  });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.getSetCookie()[0], /Max-Age=0/u);
  assert.equal((await fixture.request('/api/me', { headers: { Cookie: session.cookie } })).status, 401);
});

test('public assets and API responses expose no configured or OAuth credentials', async (t) => {
  const fixture = await setup(t);
  for (const path of ['/', '/app.js', '/styles.css', '/api/status']) {
    const response = await fixture.request(path);
    assert.equal(response.status, 200);
    noSecrets(await response.text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/u);
  }
  const session = await fixture.login();
  for (const path of ['/api/me', `/api/guilds/${GUILD}`, `/api/guilds/${GUILD}/logs`, `/api/guilds/${GUILD}/music`]) {
    const response = await fixture.request(path, { headers: { Cookie: session.cookie } });
    assert.equal(response.status, 200);
    noSecrets(await response.text());
  }
  assert.equal((await fixture.request('/.env', { headers: { Cookie: session.cookie } })).status, 404);
  assert.equal((await fixture.request('/src/config.js', { headers: { Cookie: session.cookie } })).status, 404);
});

test('RPG item icons are public immutable assets and do not consume the API rate limit', async (t) => {
  const fixture = await setup(t), icon = '/assets/rpg/saf-isigin-muhafizi-staffi.webp';
  for (let index = 0; index < 35; index++) {
    const response = await fixture.request(icon, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.match(response.headers.get('cache-control'), /immutable/u);
  }
  assert.equal((await fixture.request('/api/me')).status, 401);
  assert.equal((await fixture.request('/assets/rpg/not-a-catalog-item.webp')).status, 401);
});

test('missing OAuth configuration keeps the public dashboard available and login closed', async (t) => {
  const fixture = await setup(t, { clientSecret: '', sessionSecret: '' });
  const status = await fixture.request('/api/status');
  assert.equal((await status.json()).loginConfigured, false);
  assert.equal((await fixture.request('/')).status, 200);
  assert.equal((await fixture.request('/auth/login')).status, 503);
  assert.equal(fixture.calls.discord.length, 0);
});
