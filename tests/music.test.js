import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ChannelType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { assertVoiceAccess, createMusic, MAX_PLAYLIST, MAX_QUEUE, MusicError, normalizeMusicQuery, selectQueueTracks, playbackFailure } from '../src/music.js';

test('playback errors give actionable categories without leaking provider responses', () => {
  for (const [message, code] of [['Please sign in', 'LOGIN_REQUIRED'], ['Must find sig function', 'PLAYER_COMPATIBILITY'], ['429 Too many requests', 'RATE_LIMIT'], ['Not success status code: 403', 'SOURCE_UNAVAILABLE'], ['Connection timed out', 'SOURCE_CONNECTION'], ['unrecognized response', 'PLAYBACK_FAILED']]) {
    const result = playbackFailure({ exception: { message, cause: 'https://example.test/?token=PRIVATE' } });
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  assert.equal(playbackFailure(null).code, 'PLAYBACK_FAILED');
});

const fullPermissions = new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]);
function track(index = 0) {
  return { encoded: `encoded${index}`, info: { title: `Track ${index}`, author: 'Artist', duration: 123000, uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sourceName: 'youtube' }, requester: { id: 'member' } };
}
function setup({ musicEnabled = true, djRoleId = null, search, botChannelId = null } = {}) {
  const settings = { musicEnabled, djRoleId, musicVolume: 50 };
  const voiceChannel = { id: 'voice', type: ChannelType.GuildVoice, userLimit: 0,
    members: new Map(), permissionsFor: () => fullPermissions };
  const member = { id: 'member', user: { id: 'member', username: 'User', bot: false },
    voice: { channel: voiceChannel, channelId: voiceChannel.id },
    roles: { cache: new Set() }, permissions: new PermissionsBitField() };
  const botMember = { voice: { channelId: botChannelId } };
  const logs = [];
  let joins = 0;
  let searches = 0;
  const node = { id: 'node', connected: true,
    async search(query, requester) { searches++; return search ? search(query, requester) : { loadType: 'search', tracks: [track()] }; },
    destroy() {} };
  const manager = new EventEmitter();
  manager.nodeManager = new EventEmitter();
  manager.nodeManager.nodes = new Map([['node', node]]);
  manager.nodeManager.leastUsedNodes = () => [node];
  manager.players = new Map();
  manager.useable = true;
  manager.getPlayer = id => manager.players.get(id);
  manager.createPlayer = options => {
    const player = { ...options, connected: false, playing: false, paused: false, node, position: 0,
      queue: { current: null, tracks: [], async add(tracks) { this.tracks.push(...tracks); } },
      async connect() { joins++; this.connected = true; },
      async play() { this.queue.current = this.queue.tracks.shift(); this.playing = true; },
      async destroy() { this.connected = false; manager.players.delete(this.guildId); },
      async pause() { this.paused = true; }, async resume() { this.paused = false; },
      async skip(skipTo, shouldThrow) { assert.equal(skipTo, 0); assert.equal(shouldThrow, false); this.queue.current = this.queue.tracks.shift() || null; },
      async setVolume(volume) { this.volume = volume; },
    };
    manager.players.set(options.guildId, player);
    return player;
  };
  const guild = { members: { fetch: async () => member, me: botMember }, channels: { cache: new Map([['voice', voiceChannel]]) } };
  const client = { guilds: { cache: new Map([['guild', guild]]) }, channels: { cache: new Map() }, user: { id: 'bot', username: 'Pit-Stop' } };
  const music = createMusic(client, { getSettings: () => settings, addLog: (...args) => logs.push(args) }, { spotifyConfigured: false }, { manager });
  return { music, manager, member, botMember, voiceChannel, settings, logs, joins: () => joins, searches: () => searches };
}

test('canonicalizes supported URLs and removes tracking, redirects and incidental playlist queries', () => {
  assert.deepEqual(normalizeMusicQuery('https://youtu.be/dQw4w9WgXcQ?si=secret&redirect=https://127.0.0.1'), { query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'ytmsearch', spotify: false });
  assert.equal(normalizeMusicQuery('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLexample').query, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(normalizeMusicQuery('https://www.youtube.com/playlist?list=PLexample&si=abc').query, 'https://www.youtube.com/playlist?list=PLexample');
  assert.equal(normalizeMusicQuery('https://open.spotify.com/intl-tr/track/4PTG3Z6ehGkBFwjybzWkR8?si=secret').query, 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8');
  assert.deepEqual(normalizeMusicQuery('ytsearch:Daft Punk One More Time'), { query: 'Daft Punk One More Time', source: 'ytsearch', spotify: false });
});

test('rejects network and Lavalink source injection before making remote requests', () => {
  for (const query of [
    'https://127.0.0.1/admin', 'https://169.254.169.254/latest/meta-data', 'http://localhost', '//localhost/admin',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ',
    'https://evil.test@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:3000/watch?v=dQw4w9WgXcQ',
    'file:///etc/passwd', 'local:/etc/passwd', 'http://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'ytsearch:http://localhost', 'ytsearch:https://youtube.com/redirect?q=https://evil.test',
    'speak:hello', 'spsearch:unapproved', '127.0.0.1', 'www.evil.test/path', 'https://open.spotify.com/redirect',
    'https://youtu.be/bad', 'https://youtube.com/watch?v=bad', 'https://youtube.com/redirect?url=http://localhost',
    'ytmsearch:', '\u0000artist', 'a'.repeat(501),
  ]) assert.throws(() => normalizeMusicQuery(query), MusicError, query);
});

test('music names remain searches, and only the first search result is queued', () => {
  assert.equal(normalizeMusicQuery('Müslüm Gürses Affet').source, 'ytmsearch');
  assert.equal(normalizeMusicQuery('Daft Punk', 'ytsearch').source, 'ytsearch');
  const result = selectQueueTracks({ loadType: 'search', tracks: [track(0), track(1)] }, 0);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.truncated, false);
});

test('playlist and existing queue limits apply together without exceeding either cap', () => {
  const playlist = { loadType: 'playlist', tracks: Array.from({ length: 300 }, (_, index) => track(index)) };
  assert.equal(selectQueueTracks(playlist, 0).tracks.length, MAX_PLAYLIST);
  assert.equal(selectQueueTracks(playlist, MAX_QUEUE - 3).tracks.length, 3);
  assert.equal(selectQueueTracks(playlist, MAX_QUEUE - 3).truncated, true);
  assert.throws(() => selectQueueTracks(playlist, MAX_QUEUE), /Kuyruk dolu/);
  assert.throws(() => selectQueueTracks({ loadType: 'empty', tracks: [] }, 0), /bulunamadı/);
});

test('voice controls require same channel and DJ role, including administrators joining another channel', () => {
  const fixture = setup({ djRoleId: 'dj' });
  const { member, botMember, voiceChannel, settings } = fixture;
  assert.throws(() => assertVoiceAccess(member, botMember, null, settings), /DJ rolü/);
  member.roles.cache.add('dj');
  assert.equal(assertVoiceAccess(member, botMember, null, settings), voiceChannel);
  assert.throws(() => assertVoiceAccess(member, botMember, { voiceChannelId: 'other' }, settings), /aynı ses/);
  member.permissions.add(PermissionFlagsBits.Administrator);
  assert.throws(() => assertVoiceAccess(member, botMember, { voiceChannelId: 'other' }, settings), /aynı ses/);
  member.roles.cache.clear();
  assert.equal(assertVoiceAccess(member, botMember, null, settings), voiceChannel);
  member.voice.channel = null;
  assert.throws(() => assertVoiceAccess(member, botMember, null, settings), /ses kanalına/);
});

test('permission, stage and full voice-channel failures prevent connecting', () => {
  const { member, botMember, voiceChannel } = setup();
  voiceChannel.permissionsFor = () => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
  assert.throws(() => assertVoiceAccess(member, botMember, null), /Konuş izinleri/);
  voiceChannel.permissionsFor = () => fullPermissions;
  voiceChannel.type = ChannelType.GuildStageVoice;
  assert.throws(() => assertVoiceAccess(member, botMember, null), /Sahne/);
  voiceChannel.type = ChannelType.GuildVoice; voiceChannel.userLimit = 1; voiceChannel.members.set('member', member);
  assert.throws(() => assertVoiceAccess(member, botMember, null), /kanalı dolu/);
});

test('failed and empty searches never join a voice channel', async () => {
  const empty = setup({ search: async () => ({ loadType: 'empty', tracks: [] }) });
  await assert.rejects(empty.music.control('guild', 'play', { query: 'song' }, 'member'), /Parça bulunamadı/);
  assert.equal(empty.joins(), 0);
  const failed = setup({ search: async () => { throw new Error('secret password in remote response'); } });
  await assert.rejects(failed.music.control('guild', 'play', { query: 'song' }, 'member'), error => error instanceof MusicError && !error.message.includes('secret'));
  assert.equal(failed.joins(), 0);
});

test('unconfigured Spotify and disabled music fail before source access', async () => {
  const fixture = setup();
  await assert.rejects(fixture.music.control('guild', 'play', { query: 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8' }, 'member'), /Spotify entegrasyonu/);
  fixture.settings.musicEnabled = false;
  await assert.rejects(fixture.music.control('guild', 'play', { query: 'song' }, 'member'), /sunucuda kapalı/);
  assert.equal(fixture.searches(), 0);
});

test('concurrent requests cannot race queue limits or retain unbounded pending searches', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = setup({ search: () => pending });
  const first = fixture.music.control('guild', 'play', { query: 'song' }, 'member');
  await assert.rejects(fixture.music.control('guild', 'play', { query: 'other' }, 'member'), error => error.status === 429);
  release({ loadType: 'playlist', tracks: Array.from({ length: 300 }, (_, i) => track(i)) });
  const result = await first;
  assert.equal(result.queue.length + (result.current ? 1 : 0), MAX_PLAYLIST);
  assert.equal(fixture.searches(), 1);
});

test('voice changes while resolving audio cancel play without joining', async () => {
  let fixture;
  fixture = setup({ search: async () => { fixture.member.voice.channel = null; fixture.member.voice.channelId = null; return { loadType: 'track', tracks: [track()] }; } });
  await assert.rejects(fixture.music.control('guild', 'play', { query: 'song' }, 'member'), /ses kanalına/);
  assert.equal(fixture.joins(), 0);
});

test('playback controls, queue status and administrative settings apply to the actual player', async () => {
  const fixture = setup();
  const play = await fixture.music.control('guild', 'play', { query: 'song' }, 'member');
  assert.equal(play.current.title, 'Track 0'); assert.equal(play.connected, true); assert.equal(play.volume, 50);
  const pause = await fixture.music.control('guild', 'pause', {}, 'member'); assert.equal(pause.paused, true);
  const resume = await fixture.music.control('guild', 'resume', {}, 'member'); assert.equal(resume.paused, false);
  await assert.rejects(fixture.music.control('guild', 'volume', { volume: 101 }, 'member'), /0–100/);
  const volume = await fixture.music.control('guild', 'volume', { volume: 35 }, 'member'); assert.equal(volume.volume, 35);
  const skip = await fixture.music.control('guild', 'skip', {}, 'member'); assert.equal(skip.current, null);
  fixture.settings.musicVolume = 20;
  await fixture.music.applySettings('guild'); assert.equal(fixture.music.getStatus('guild').volume, 20);
  fixture.settings.musicEnabled = false; fixture.member.voice.channel = null;
  await fixture.music.applySettings('guild'); assert.equal(fixture.manager.players.size, 0);
  assert.ok(fixture.logs.length >= 5);
});

test('no audio node permits command registration and dashboard with honest unavailable status', async () => {
  const music = createMusic({}, { getSettings: () => ({ musicEnabled: true }), addLog() {} }, {});
  assert.deepEqual(music.commands.map(command => command.data.toJSON().name), ['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'volume']);
  assert.equal(music.getStatus('guild').available, false);
  await assert.rejects(music.control('guild', 'play', { query: 'song' }, 'member'), error => error.status === 503 && error.userMessage.includes('Lavalink'));
  await music.initialize(); await music.close();
});
