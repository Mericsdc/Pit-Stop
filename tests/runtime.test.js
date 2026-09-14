import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { MessageFlags, Routes, SlashCommandBuilder } from 'discord.js';
import { readConfig, readSnowflake } from '../src/config.js';
import { createHealthServer } from '../src/health.js';
import { safeError } from '../src/logger.js';
import { registerCommands } from '../src/register.js';
import { createInteractionHandler } from '../src/router.js';

const CLIENT = '1400000000000000000';
const GUILD = '1400000000000000001';
const USER = '1400000000000000002';
const CHANNEL = '1400000000000000003';
const credentials = { DISCORD_TOKEN: 'test-only-token', DISCORD_CLIENT_ID: CLIENT };

test('configuration defaults keep the panel local and optional integrations disabled', () => {
  const config = readConfig(credentials);
  assert.equal(config.healthPort, 3000);
  assert.equal(config.dashboardPort, 3001);
  assert.equal(config.dashboardHost, '127.0.0.1');
  assert.equal(config.publicUrl, 'http://localhost:3001');
  assert.equal(config.dataDir, resolve('./data'));
  assert.equal(config.guildId, undefined);
  assert.equal(config.clientSecret, undefined);
  assert.equal(config.sessionSecret, undefined);
  assert.equal(config.lavalink, undefined);
  assert.equal(config.spotifyConfigured, false);
});

for (const [label, overrides, expected] of [
  ['missing token', { DISCORD_TOKEN: undefined }, /DISCORD_TOKEN/],
  ['blank token', { DISCORD_TOKEN: '   ' }, /DISCORD_TOKEN/],
  ['placeholder token', { DISCORD_TOKEN: 'your_bot_token' }, /DISCORD_TOKEN/],
  ['missing application ID', { DISCORD_CLIENT_ID: undefined }, /DISCORD_CLIENT_ID/],
  ['zero application ID', { DISCORD_CLIENT_ID: '00000000000000000' }, /DISCORD_CLIENT_ID/],
  ['overflow application ID', { DISCORD_CLIENT_ID: '18446744073709551616' }, /DISCORD_CLIENT_ID/],
  ['nonnumeric guild ID', { DISCORD_GUILD_ID: 'invalid-guild' }, /DISCORD_GUILD_ID/],
  ['health port zero', { HEALTH_PORT: '0' }, /HEALTH_PORT/],
  ['health port overflow', { HEALTH_PORT: '65536' }, /HEALTH_PORT/],
  ['health port fraction', { HEALTH_PORT: '3000.5' }, /HEALTH_PORT/],
  ['health port text', { HEALTH_PORT: 'abc' }, /HEALTH_PORT/],
  ['dashboard port zero', { DASHBOARD_PORT: '0' }, /DASHBOARD_PORT/],
  ['dashboard port overflow', { DASHBOARD_PORT: '65536' }, /DASHBOARD_PORT/],
  ['dashboard port fraction', { DASHBOARD_PORT: '3001.5' }, /DASHBOARD_PORT/],
  ['colliding ports', { DASHBOARD_PORT: '3000' }, /farklı port/],
  ['public HTTP', { PUBLIC_URL: 'http://pit-stop.example.com' }, /HTTPS/],
  ['invalid public URL', { PUBLIC_URL: 'not-a-url' }, /PUBLIC_URL/],
  ['public URL path', { PUBLIC_URL: 'https://pit-stop.example.com/dashboard' }, /PUBLIC_URL/],
  ['public URL query', { PUBLIC_URL: 'https://pit-stop.example.com?token=hidden' }, /PUBLIC_URL/],
  ['public URL fragment', { PUBLIC_URL: 'https://pit-stop.example.com#settings' }, /PUBLIC_URL/],
  ['public URL credentials', { PUBLIC_URL: 'https://user:secret@pit-stop.example.com' }, /PUBLIC_URL/],
  ['short session secret', { SESSION_SECRET: 'too-short' }, /SESSION_SECRET/],
  ['OAuth without session secret', { DISCORD_CLIENT_SECRET: 'test-client-secret' }, /SESSION_SECRET/],
  ['Lavalink host without password', { LAVALINK_HOST: 'lavalink' }, /LAVALINK_PASSWORD/],
  ['invalid Lavalink port', { LAVALINK_HOST: 'lavalink', LAVALINK_PASSWORD: 'test-lavalink-password', LAVALINK_PORT: '65536' }, /LAVALINK_PORT/],
]) {
  test(`configuration rejects ${label}`, () => {
    assert.throws(() => readConfig({ ...credentials, ...overrides }), expected);
  });
}

test('configuration accepts HTTPS OAuth, valid boundary ports and persistent storage', () => {
  const dataDir = resolve('runtime-test-data');
  const config = readConfig({
    DISCORD_TOKEN: ` ${credentials.DISCORD_TOKEN} `,
    DISCORD_CLIENT_ID: ` ${CLIENT} `,
    DISCORD_GUILD_ID: ` ${GUILD} `,
    HEALTH_PORT: '1', DASHBOARD_PORT: '65535',
    PUBLIC_URL: ' https://pit-stop.example.com/ ',
    DISCORD_CLIENT_SECRET: ' test-client-secret ',
    SESSION_SECRET: 'x'.repeat(32), DATA_DIR: dataDir,
  });
  assert.equal(config.token, credentials.DISCORD_TOKEN);
  assert.equal(config.clientId, CLIENT);
  assert.equal(config.guildId, GUILD);
  assert.equal(config.publicUrl, 'https://pit-stop.example.com');
  assert.equal(config.clientSecret, 'test-client-secret');
  assert.equal(config.sessionSecret.length, 32);
  assert.equal(config.dataDir, dataDir);
  assert.equal(config.healthPort, 1);
  assert.equal(config.dashboardPort, 65535);
  assert.equal(readSnowflake('18446744073709551615', 'ID'), '18446744073709551615');
});

test('loopback HTTP is accepted for SSH tunnel access', () => {
  for (const publicUrl of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
    assert.equal(readConfig({ ...credentials, PUBLIC_URL: publicUrl }).publicUrl, publicUrl);
  }
});

test('Lavalink and Spotify activate only with their required configuration', () => {
  const config = readConfig({
    ...credentials, LAVALINK_HOST: ' lavalink ', LAVALINK_PASSWORD: ' node-password ',
    LAVALINK_PORT: '2443', LAVALINK_SECURE: 'true',
    SPOTIFY_ENABLED: 'true', SPOTIFY_CLIENT_ID: 'spotify-id', SPOTIFY_CLIENT_SECRET: 'spotify-secret',
  });
  assert.deepEqual(config.lavalink, { host: 'lavalink', password: 'node-password', port: 2443, secure: true });
  assert.equal(config.spotifyConfigured, true);
  assert.equal(readConfig({ ...credentials, SPOTIFY_ENABLED: 'true', SPOTIFY_CLIENT_ID: 'spotify-id' }).spotifyConfigured, false);
  assert.equal(readConfig({ ...credentials, SPOTIFY_CLIENT_ID: 'spotify-id', SPOTIFY_CLIENT_SECRET: 'spotify-secret' }).spotifyConfigured, false);
});

test('loopback health endpoint follows Discord readiness and does not cache it', async (t) => {
  let ready = false;
  const server = createHealthServer(() => ready);
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise((done) => server.close(done));
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  for (const expectedReady of [false, true, false]) {
    ready = expectedReady;
    const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, expectedReady ? 200 : 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { name: 'Pit-Stop', status: expectedReady ? 'ready' : 'connecting' });
  }
  const missing = await fetch(`${base}/unknown`, { signal: AbortSignal.timeout(2000) });
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), '');
});

function interaction(overrides = {}) {
  const calls = { replies: [], edits: [] };
  const value = {
    isChatInputCommand: () => true, inGuild: () => true,
    commandName: 'ping', guildId: GUILD, user: { id: USER }, channelId: CHANNEL,
    deferred: false, replied: false,
    reply: async (payload) => { calls.replies.push(payload); value.replied = true; },
    editReply: async (payload) => { calls.edits.push(payload); },
    ...overrides,
  };
  return { value, calls };
}

function command(name = 'ping', execute = async () => {}) {
  return { data: { name }, execute };
}

test('router ignores other interaction types and rejects DM commands privately', async () => {
  let executions = 0;
  const handle = createInteractionHandler([command('ping', async () => { executions++; })]);
  const component = interaction({ isChatInputCommand: () => false });
  await handle(component.value);
  assert.deepEqual(component.calls, { replies: [], edits: [] });
  const dm = interaction({ inGuild: () => false, guildId: null });
  await handle(dm.value);
  assert.equal(executions, 0);
  assert.match(dm.calls.replies[0].content, /sunucuda/);
  assert.equal(dm.calls.replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(dm.calls.replies[0].allowedMentions, { parse: [] });
});

test('router answers stale command names privately without executing a command', async () => {
  const unknown = interaction({ commandName: 'removed' });
  await createInteractionHandler([command()])(unknown.value);
  assert.match(unknown.calls.replies[0].content, /yardim/);
  assert.equal(unknown.calls.replies[0].flags, MessageFlags.Ephemeral);
});

test('router cooldowns are scoped to guild, user and command and expire at the boundary', async () => {
  let now = 5000;
  const executions = [];
  const audits = [];
  const execute = async (value) => executions.push([value.guildId, value.user.id, value.commandName]);
  const handle = createInteractionHandler([command('ping', execute), command('yardim', execute)], {
    now: () => now, cooldownMs: 3000, store: { addLog: (...args) => audits.push(args) },
  });
  await handle(interaction().value);
  const limited = interaction();
  await handle(limited.value);
  assert.match(limited.calls.replies[0].content, /hızlısınız/);
  assert.equal(limited.calls.replies[0].flags, MessageFlags.Ephemeral);
  await handle(interaction({ guildId: '1400000000000000010' }).value);
  await handle(interaction({ user: { id: '1400000000000000011' } }).value);
  await handle(interaction({ commandName: 'yardim' }).value);
  assert.equal(executions.length, 4);
  now = 7999;
  await handle(interaction().value);
  assert.equal(executions.length, 4);
  now = 8000;
  await handle(interaction().value);
  assert.equal(executions.length, 5);
  assert.equal(audits.length, 5);
  assert.equal(audits[0][0], GUILD);
  assert.deepEqual(audits[0][1], {
    type: 'command.executed', actorId: USER,
    message: '/ping komutu işlendi.', details: { channelId: CHANNEL },
  });
});

test('command errors produce a private generic reply and sanitized diagnostic and audit logs', async () => {
  const secret = 'private-credential-that-must-not-be-logged';
  const error = Object.assign(new Error(secret), { code: 50013, requestBody: { token: secret }, headers: { Authorization: secret } });
  const diagnostics = [];
  const audits = [];
  const handle = createInteractionHandler([command('ping', async () => { throw error; })], {
    logger: (...args) => diagnostics.push(args), store: { addLog: (...args) => audits.push(args) },
  });
  const fixture = interaction();
  await assert.doesNotReject(() => handle(fixture.value));
  assert.equal(fixture.calls.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(fixture.calls.replies[0].content, /tamamlanamadı/);
  assert.deepEqual(fixture.calls.replies[0].allowedMentions, { parse: [] });
  assert.deepEqual(diagnostics, [['error', 'command_failed', { command: 'ping', name: 'Error', code: 50013 }]]);
  assert.equal(audits[0][1].type, 'command.failed');
  assert.deepEqual(audits[0][1].details, { name: 'Error', code: 50013 });
  assert.equal(JSON.stringify({ diagnostics, audits, calls: fixture.calls }).includes(secret), false);
});

for (const state of ['deferred', 'replied']) {
  test(`router edits a ${state} response after a command error without sending a second initial reply`, async () => {
    const fixture = interaction({ [state]: true });
    await createInteractionHandler([command('ping', async () => { throw new Error('failure'); })])(fixture.value);
    assert.equal(fixture.calls.replies.length, 0);
    assert.equal(fixture.calls.edits.length, 1);
    assert.match(fixture.calls.edits[0].content, /tamamlanamadı/);
    assert.deepEqual(fixture.calls.edits[0].allowedMentions, { parse: [] });
  });
}

test('failed audit writes and unavailable Discord error replies do not escape the handler or expose secrets', async () => {
  const diagnostics = [];
  const secret = 'secret-in-error-payload';
  const handle = createInteractionHandler([command('ping', async () => { throw new Error(secret); })], {
    logger: (...args) => diagnostics.push(args),
    store: { addLog: () => { throw new Error(secret); } },
  });
  const fixture = interaction({ reply: async () => { throw Object.assign(new Error(secret), { code: 10062 }); } });
  await assert.doesNotReject(() => handle(fixture.value));
  assert.deepEqual(diagnostics.map((entry) => entry[1]), ['command_failed', 'error_reply_failed']);
  assert.equal(diagnostics[1][2].code, 10062);
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.deepEqual(safeError({ name: 'bad secret name', code: 'secret-code', message: secret }), { name: 'Error', code: undefined });
});

function registrationCommand(name) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} komutu`).setContexts(0).setIntegrationTypes(0),
  };
}

test('global registration POST-upserts owned names while preserving unrelated remote commands', async () => {
  const existing = new Map([['external', { name: 'external', description: 'Keep this command' }]]);
  const calls = [];
  const rest = {
    post: async (route, { body }) => { calls.push({ route, body }); existing.set(body.name, body); },
    put: async () => assert.fail('Bulk PUT must never replace existing application commands'),
    delete: async () => assert.fail('Registration must never delete unrelated commands'),
  };
  const owned = [registrationCommand('ping'), registrationCommand('yardim')];
  assert.equal(await registerCommands(rest, { clientId: CLIENT }, owned), 2);
  assert.deepEqual(calls.map(({ route }) => route), [Routes.applicationCommands(CLIENT), Routes.applicationCommands(CLIENT)]);
  assert.deepEqual([...existing.keys()], ['external', 'ping', 'yardim']);
  assert.deepEqual(existing.get('external'), { name: 'external', description: 'Keep this command' });
  assert.deepEqual(calls[0].body.contexts, [0]);
  assert.deepEqual(calls[0].body.integration_types, [0]);
});

test('guild registration removes unsupported context fields without mutating command builders', async () => {
  const owned = registrationCommand('ping');
  const before = owned.data.toJSON();
  const calls = [];
  assert.equal(await registerCommands({ post: async (...args) => calls.push(args) }, { clientId: CLIENT, guildId: GUILD }, [owned]), 1);
  assert.equal(calls[0][0], Routes.applicationGuildCommands(CLIENT, GUILD));
  assert.equal(Object.hasOwn(calls[0][1].body, 'contexts'), false);
  assert.equal(Object.hasOwn(calls[0][1].body, 'integration_types'), false);
  assert.equal(calls[0][1].body.name, 'ping');
  assert.deepEqual(owned.data.toJSON(), before);
});

test('global registration also refreshes allowed guild commands immediately', async () => {
  const owned = registrationCommand('panel-giris'), calls = [];
  const rest = { get: async () => [], post: async (route, options) => calls.push({ route, body: options.body }) };
  await registerCommands(rest, { clientId: CLIENT, allowedGuildIds: [GUILD] }, [owned]);
  assert.deepEqual(calls.map(item => item.route), [Routes.applicationCommands(CLIENT), Routes.applicationGuildCommands(CLIENT, GUILD)]);
  assert.deepEqual(calls[0].body.contexts, [0]);
  assert.equal(Object.hasOwn(calls[1].body, 'contexts'), false);
});

test('registration propagates Discord failures and stops before advertising success', async () => {
  const calls = [];
  const failure = new Error('Discord unavailable');
  await assert.rejects(() => registerCommands({ post: async (route) => { calls.push(route); throw failure; } }, { clientId: CLIENT }, [registrationCommand('ping'), registrationCommand('yardim')]), (error) => error === failure);
  assert.equal(calls.length, 1);
});

test('unchanged command definitions avoid Discord write rate limits on restart', async () => {
  const owned = registrationCommand('ping');
  let writes = 0;
  const rest = { get: async () => [{ ...owned.data.toJSON(), id: 'remote', version: 'version', type: 1, nsfw: false, options: [], description_localizations: null }], post: async () => { writes++; } };
  await registerCommands(rest, { clientId: CLIENT }, [owned]); assert.equal(writes, 0);
  rest.get = async () => [{ ...owned.data.toJSON(), description: 'Old description' }];
  await registerCommands(rest, { clientId: CLIENT }, [owned]); assert.equal(writes, 1);
});

test('registration deletes only the renamed legacy health command', async () => {
  const owned = registrationCommand('healthcare'), removed = [];
  const rest = {
    get: async () => [{ id: 'legacy-id', name: 'sağlık-asistanı' }, { id: 'external-id', name: 'external' }],
    delete: async route => removed.push(route),
    post: async () => {},
  };
  await registerCommands(rest, { clientId: CLIENT }, [owned]);
  assert.deepEqual(removed, [`${Routes.applicationCommands(CLIENT)}/legacy-id`]);
});
