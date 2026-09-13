import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import { safeError } from './logger.js';

export const MAX_QUEUE = 200;
export const MAX_PLAYLIST = 50;
const IDLE_MS = 120_000;
const NO_NODE = 'Müzik sunucusu hazır değil. Yönetici Lavalink bağlantısını ve paneldeki müzik ayarlarını kontrol etmelidir.';
const SPOTIFY_NOTE = 'Spotify parça bilgileri YouTube ile eşleştirilir; ses doğrudan Spotify’dan aktarılmaz.';

export class MusicError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'MusicError'; this.status = status; this.userMessage = message; }
}

export function playbackFailure(payload) {
  // Classify upstream errors without exposing token-bearing URLs or raw provider responses.
  const raw = [payload?.exception?.message, payload?.exception?.cause].filter(v => typeof v === 'string').join(' ').replace(/https?:\/\/\S+/gi, '').toLowerCase();
  if (/oauth|sign.?in|login|authentication|confirm.*bot/.test(raw)) return { code: 'LOGIN_REQUIRED', message: 'YouTube oturumu gerekiyor veya oturum yenilenemiyor.' };
  if (/cipher|signature|sig function|player script/.test(raw)) return { code: 'PLAYER_COMPATIBILITY', message: 'YouTube ses bağlantısı hazırlanamadı; müzik bileşeni kontrol edilmeli.' };
  if (/429|rate.?limit|too many/.test(raw)) return { code: 'RATE_LIMIT', message: 'Müzik kaynağının istek sınırına ulaşıldı. Bir süre sonra tekrar deneyin.' };
  if (/403|unavailable|private|not available|copyright|restricted/.test(raw)) return { code: 'SOURCE_UNAVAILABLE', message: 'Bu parçanın ses kaynağına erişilemiyor. Başka bir kayıt deneyin.' };
  if (/timeout|timed out|connection/.test(raw)) return { code: 'SOURCE_CONNECTION', message: 'Ses kaynağı bağlantısı kesildi veya zaman aşımına uğradı.' };
  return { code: 'PLAYBACK_FAILED', message: 'Ses akışı başlatılamadı. Başka bir kayıt deneyin; sorun sürerse yönetici müzik servisini kontrol etmelidir.' };
}

/** Only canonical media URLs reach Lavalink; no redirects, arbitrary sources or local files. */
export function normalizeMusicQuery(input, source = 'ytmsearch') {
  if (typeof input !== 'string' || !input.trim() || input.length > 500 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new MusicError('1–500 karakterlik bir şarkı adı veya YouTube/Spotify bağlantısı girin.');
  }
  if (!['ytsearch', 'ytmsearch'].includes(source)) throw new MusicError('Arama kaynağı YouTube veya YouTube Music olmalı.');
  let query = input.trim();
  const prefix = /^(ytsearch|ytmsearch):/i.exec(query);
  if (prefix) { source = prefix[1].toLowerCase(); query = query.slice(prefix[0].length).trim(); }
  if (!query) throw new MusicError('Şarkı adını yazın.');
  if (/^https:\/\//i.test(query)) {
    let url;
    try { url = new URL(query); } catch { throw new MusicError('Geçerli bir HTTPS bağlantısı girin.'); }
    if (url.username || url.password || url.port || /[\\\s]/.test(query)) throw new MusicError('Bu bağlantı desteklenmiyor.');
    const host = url.hostname.toLowerCase();
    if (host === 'open.spotify.com') {
      const match = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      if (!match) throw new MusicError('Spotify parça, albüm, sanatçı veya herkese açık çalma listesi bağlantısı girin.');
      return { query: `https://open.spotify.com/${match[1]}/${match[2]}`, source, spotify: true };
    }
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
      let id;
      if (host.endsWith('youtu.be')) id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
      else if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
        return { query: `https://www.youtube.com/watch?v=${id}`, source, spotify: false };
      }
      const list = url.searchParams.get('list');
      if (url.pathname === '/playlist' && list && /^[A-Za-z0-9_-]{5,150}$/.test(list)) {
        return { query: `https://www.youtube.com/playlist?list=${list}`, source, spotify: false };
      }
      throw new MusicError('YouTube video veya çalma listesi bağlantısı girin.');
    }
    throw new MusicError('Yalnızca YouTube, YouTube Music ve open.spotify.com bağlantıları destekleniyor.');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(query) || /:\/\/|^[\\/]|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:^|\s)(?:localhost|(?:[\w-]+\.)+[a-z]{2,})(?:[/:\s]|$)/i.test(query)) {
    throw new MusicError('Şarkı adı arayın veya tam bir YouTube/Spotify HTTPS bağlantısı girin.');
  }
  return { query, source, spotify: false };
}

export function selectQueueTracks(result, occupied, maxQueue = MAX_QUEUE, maxPlaylist = MAX_PLAYLIST) {
  if (result?.loadType === 'error') throw new MusicError('Kaynak parçayı yükleyemedi. Bağlantıyı veya kaynak erişimini kontrol edin.');
  const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
  if (!tracks.length) throw new MusicError('Parça bulunamadı. Daha açık bir şarkı adı veya başka bir bağlantı deneyin.');
  const available = Math.max(0, maxQueue - occupied);
  if (!available) throw new MusicError(`Kuyruk dolu. En fazla ${maxQueue} parça tutulabilir.`);
  const isPlaylist = result.loadType === 'playlist';
  const requested = isPlaylist ? tracks : tracks.slice(0, 1);
  const selected = requested.slice(0, Math.min(available, isPlaylist ? maxPlaylist : 1));
  return { tracks: selected, truncated: requested.length > selected.length, total: requested.length };
}

export function assertVoiceAccess(member, botMember, player, settings = {}, { requireDj = true } = {}) {
  const channel = member?.voice?.channel;
  if (!channel) throw new MusicError('Önce bir ses kanalına katılın.');
  if (channel.type !== ChannelType.GuildVoice) throw new MusicError('Müzik için normal bir ses kanalı kullanın. Sahne kanalları desteklenmiyor.');
  const botChannelId = player?.voiceChannelId || botMember?.voice?.channelId;
  if (botChannelId && channel.id !== botChannelId) throw new MusicError('Bot ile aynı ses kanalında olmalısınız.', 403);
  if (settings.musicRestricted && !member.permissions.has(PermissionFlagsBits.ManageGuild)
    && !(settings.musicControllerUserIds || []).includes(member.id)
    && !(settings.musicControllerRoleIds || []).some(id => member.roles.cache.has(id))
    && !(settings.djRoleId && member.roles.cache.has(settings.djRoleId))) throw new MusicError('Müzik ve botun ses bağlantısı yalnızca panelde belirlenen yetkililer tarafından yönetilebilir.', 403);
  if (requireDj && settings.djRoleId && !member.roles.cache.has(settings.djRoleId)
    && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new MusicError('Bu sunucuda müzik yönetimi için DJ rolü gerekiyor.', 403);
  }
  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new MusicError('Botun ses kanalında Kanalı Görüntüle, Bağlan ve Konuş izinleri olmalı.', 403);
  }
  if (!botChannelId && channel.userLimit > 0 && channel.members.size >= channel.userLimit
    && !permissions.has(PermissionFlagsBits.MoveMembers)) throw new MusicError('Ses kanalı dolu.');
  return channel;
}

function serializeTrack(track) {
  if (!track) return null;
  const info = track.info || {};
  let uri = null;
  try { uri = normalizeMusicQuery(info.uri).query; } catch { /* Unknown media URLs never appear in panel links. */ }
  let artworkUrl = info.artworkUrl || null;
  if (!artworkUrl && info.sourceName === 'youtube' && /^[\w-]{11}$/u.test(info.identifier || '')) artworkUrl = `https://i.ytimg.com/vi/${info.identifier}/hqdefault.jpg`;
  if (artworkUrl) try {
    const image = new URL(artworkUrl);
    if (image.protocol !== 'https:' || !['i.ytimg.com', 'img.youtube.com', 'i.scdn.co'].includes(image.hostname)) artworkUrl = null;
    else artworkUrl = image.href;
  } catch { artworkUrl = null; }
  return {
    title: String(info.title || 'İsimsiz parça').slice(0, 200),
    author: String(info.author || '').slice(0, 200),
    duration: Number(info.duration ?? info.length) || 0,
    isStream: Boolean(info.isStream), uri,
    requesterId: track.requester?.id || null,
    source: String(info.sourceName || 'youtube').slice(0, 30), artworkUrl,
  };
}

/** manager injection keeps network-free permission/concurrency tests representative. */
export function createMusic(client, store, config = {}, { logger = () => {}, manager: suppliedManager } = {}) {
  const nodeConfig = config.lavalink;
  const configured = Boolean(suppliedManager || (nodeConfig?.host && nodeConfig?.password));
  const manager = suppliedManager || (configured ? new LavalinkManager({
    nodes: [{ id: 'pit-stop', host: nodeConfig.host, port: nodeConfig.port || 2333,
      authorization: nodeConfig.password, secure: Boolean(nodeConfig.secure),
      // Keep reconnecting after maintenance; the client bounds its retry history to 1000 entries.
      retryAmount: Number.MAX_SAFE_INTEGER, retryDelay: 30_000, requestSignalTimeoutMS: 15_000 }],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
    client: { id: config.clientId, username: 'Pit-Stop' }, autoSkip: true,
    playerOptions: { defaultSearchPlatform: 'ytmsearch', volumeDecrementer: 1,
      onDisconnect: { autoReconnect: false, destroyPlayer: true },
      onEmptyQueue: { destroyAfterMs: IDLE_MS } },
    queueOptions: { maxPreviousTracks: 5 },
    advancedOptions: { debugOptions: { noAudio: false } },
  }) : null);
  let closed = false;
  let housekeeping;
  const locks = new Map();
  const emptySince = new Map();
  const pausedSince = new Map();

  function record(guildId, type, message, actorId = null, details = {}) {
    try { store.addLog(guildId, { type, message, actorId, details }); }
    catch (error) { logger('error', 'music_log_failed', safeError(error)); }
  }
  function failLog(event, error) { logger('error', event, safeError(error)); }
  function getStatus(guildId) {
    const player = manager?.getPlayer(guildId);
    const settings = store.getSettings(guildId);
    const current = serializeTrack(player?.queue.current);
    const lastPlayed = store.getRecord?.(guildId, 'music_last', 'current')?.track || null;
    if (current) current.position = Math.max(0, player.position || 0);
    return {
      configured, available: Boolean(manager?.useable && !closed), enabled: Boolean(settings.musicEnabled),
      connected: Boolean(player?.connected),
      spotifyConfigured: Boolean(config.spotifyConfigured), spotifyNote: SPOTIFY_NOTE,
      playing: Boolean(player?.playing && !player?.paused), paused: Boolean(player?.paused),
      voiceChannelId: player?.voiceChannelId || null, textChannelId: player?.textChannelId || null,
      volume: player?.volume ?? settings.musicVolume ?? 50,
      position: player ? Math.max(0, player.position || 0) : 0,
      current, lastPlayed,
      queue: (player?.queue.tracks || []).slice(0, MAX_QUEUE).map(serializeTrack),
      maxQueue: MAX_QUEUE, maxPlaylist: MAX_PLAYLIST,
    };
  }
  async function withGuildLock(guildId, action) {
    // Reject concurrent requests instead of retaining unbounded searches or stale voice permissions.
    if (locks.has(guildId)) throw new MusicError('Önceki müzik işlemi sürüyor. Birkaç saniye sonra tekrar deneyin.', 429);
    locks.set(guildId, true);
    try { return await action(); } finally { locks.delete(guildId); }
  }
  async function getContext(guildId, actorId, player, settings) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new MusicError('Bot bu sunucuda bulunmuyor.', 404);
    const member = await guild.members.fetch({ user: actorId, force: true }).catch(() => null);
    if (!member || member.user.bot) throw new MusicError('Sunucu üyeliğiniz doğrulanamadı.', 403);
    const botMember = guild.members.me || await guild.members.fetchMe();
    const channel = assertVoiceAccess(member, botMember, player, settings);
    return { guild, member, botMember, channel };
  }
  async function perform(guildId, action, options, actorId) {
    const settings = store.getSettings(guildId);
    if (!settings.musicEnabled && action !== 'stop') throw new MusicError('Müzik bu sunucuda kapalı. Yönetici panelden etkinleştirebilir.');
    if (!manager || closed) throw new MusicError(NO_NODE, 503);
    let player = manager.getPlayer(guildId);
    if (!manager.useable && action !== 'stop') throw new MusicError(NO_NODE, 503);
    if (!['play', 'pause', 'resume', 'skip', 'stop', 'volume'].includes(action)) throw new MusicError('Bilinmeyen müzik işlemi.');
    const { member, botMember, channel } = await getContext(guildId, actorId, player, settings);
    let message;
    if (action === 'play') {
      const query = normalizeMusicQuery(options.query, options.source || 'ytmsearch');
      if (query.spotify && !config.spotifyConfigured) throw new MusicError('Spotify entegrasyonu yapılandırılmamış. SPOTIFY_ENABLED, SPOTIFY_CLIENT_ID ve SPOTIFY_CLIENT_SECRET sunucuda tanımlanmalı.');
      if ((player?.queue.tracks.length || 0) + (player?.queue.current ? 1 : 0) >= MAX_QUEUE) throw new MusicError(`Kuyruk dolu. En fazla ${MAX_QUEUE} parça tutulabilir.`);
      // Resolve before joining so failed/empty searches do not leave a bot sitting in voice.
      const node = player?.node || manager.nodeManager.leastUsedNodes()[0];
      if (!node) throw new MusicError(NO_NODE, 503);
      let result;
      try { result = await node.search({ query: query.query, source: query.source }, { id: member.id, username: member.user.username }); }
      catch (error) {
        failLog('music_search_failed', error);
        throw new MusicError(query.spotify
          ? 'Spotify bağlantısı yüklenemedi. Herkese açık bir liste/parça deneyin; yönetici Spotify erişimini kontrol etmelidir.'
          : 'YouTube araması başarısız. Kaynak şu an erişimi sınırlıyor olabilir; başka bir parça veya daha sonra tekrar deneyin.');
      }
      // Voice and settings may change while the remote source is loading.
      if (!store.getSettings(guildId).musicEnabled) throw new MusicError('Müzik arama sırasında yönetici tarafından kapatıldı.');
      player = manager.getPlayer(guildId);
      assertVoiceAccess(member, botMember, player, store.getSettings(guildId));
      if (member.voice.channelId !== channel.id) throw new MusicError('Arama sırasında ses kanalınız değişti. Tekrar deneyin.');
      const selected = selectQueueTracks(result, (player?.queue.tracks.length || 0) + (player?.queue.current ? 1 : 0));
      const isNew = !player;
      if (!player) player = manager.createPlayer({ guildId, voiceChannelId: channel.id,
        textChannelId: options.textChannelId || null, selfDeaf: true, selfMute: false,
        volume: store.getSettings(guildId).musicVolume ?? 50 });
      try {
        if (!player.connected) await player.connect();
        await player.queue.add(selected.tracks);
        if (!player.playing && !player.paused) await player.play();
      } catch (error) {
        if (isNew) await player.destroy('PlayFailed').catch(() => {});
        throw error;
      }
      message = `${selected.tracks.length} parça kuyruğa eklendi: ${escapeMarkdown(String(selected.tracks[0].info?.title || 'İsimsiz parça').slice(0, 160))}.`;
      if (selected.truncated) message += ` İstek başına ${MAX_PLAYLIST}, toplam ${MAX_QUEUE} parça sınırı uygulandı.`;
      if (query.spotify) message += ` ${SPOTIFY_NOTE}`;
      record(guildId, 'music', message, actorId, { action, actorName: member.displayName || member.user.username, query: options.query, channelId: options.textChannelId || null, voiceChannelId: channel.id, added: selected.tracks.length, tracks: selected.tracks.slice(0, 10).map(track => ({ title: String(track.info?.title || '').slice(0, 120), url: track.info?.uri })) });
    } else {
      if (!player) throw new MusicError('Etkin bir müzik oturumu yok. /play ile başlayın.');
      if (action === 'pause') {
        if (player.paused || !player.queue.current) throw new MusicError('Duraklatılacak bir parça çalmıyor.');
        await player.pause(); message = 'Müzik duraklatıldı.';
      } else if (action === 'resume') {
        if (!player.paused) throw new MusicError('Müzik zaten duraklatılmamış.');
        await player.resume(); message = 'Müzik devam ediyor.';
      } else if (action === 'skip') {
        if (!player.queue.current) throw new MusicError('Atlanacak parça yok.');
        await player.skip(0, false); message = 'Parça atlandı.';
      } else if (action === 'stop') {
        await player.destroy('UserStopped'); message = 'Müzik durduruldu, kuyruk temizlendi ve ses kanalından ayrıldım.';
      } else if (action === 'volume') {
        if (!Number.isInteger(options.volume) || options.volume < 0 || options.volume > 100) throw new MusicError('Ses seviyesi 0–100 arasında tam sayı olmalı.');
        await player.setVolume(options.volume); message = `Ses seviyesi %${options.volume} olarak ayarlandı.`;
      }
      record(guildId, 'music', message, actorId, { action });
    }
    return { message, ...getStatus(guildId) };
  }
  async function control(guildId, action, options = {}, actorId) {
    return withGuildLock(guildId, async () => {
      try { return await perform(guildId, action, options, actorId); }
      catch (error) {
        if (error instanceof MusicError) throw error;
        failLog('music_control_failed', error);
        throw new MusicError('Müzik işlemi tamamlanamadı. Ses kanalı izinlerini ve Lavalink bağlantısını kontrol edin.', 502);
      }
    });
  }
  async function applySettings(guildId) {
    const player = manager?.getPlayer(guildId);
    if (!player) return;
    const settings = store.getSettings(guildId);
    if (!settings.musicEnabled) await player.destroy('MusicDisabled');
    else if (Number.isInteger(settings.musicVolume)) await player.setVolume(settings.musicVolume);
  }

  if (manager) {
    manager.nodeManager.on('connect', () => logger('info', 'music_node_connected'));
    manager.nodeManager.on('error', (_node, error) => failLog('music_node_error', error));
    manager.nodeManager.on('disconnect', () => logger('warn', 'music_node_disconnected'));
    manager.on('trackStart', (player, track) => {
      store.putRecord?.(player.guildId, 'music_last', 'current', { track: serializeTrack(track), playedAt: Date.now() });
      record(player.guildId, 'music', `Çalıyor: ${String(track?.info?.title || 'İsimsiz parça').slice(0, 200)}`, track?.requester?.id);
    });
    manager.on('trackError', (player, track, payload) => {
      const failure = playbackFailure(payload);
      const message = `Parça çalınamadı: ${String(track?.info?.title || 'İsimsiz parça').slice(0, 180)}. ${failure.message}`;
      record(player.guildId, 'music_error', message, track?.requester?.id, { actorName: track?.requester?.username, track: track?.info?.title, url: track?.info?.uri, errorCode: failure.code });
      const textChannel = client.channels?.cache.get(player.textChannelId);
      if (textChannel?.isTextBased()) textChannel.send({ content: message, allowedMentions: { parse: [] } }).catch(error => failLog('music_notice_failed', error));
    });
    manager.on('playerDestroy', (player) => {
      emptySince.delete(player.guildId); pausedSince.delete(player.guildId);
      record(player.guildId, 'music', 'Müzik oturumu sona erdi.');
    });
  }
  async function initialize() {
    if (!manager || closed) return;
    try { await manager.init({ id: client.user.id, username: client.user.username }); }
    catch (error) { failLog('music_init_failed', error); }
    if (housekeeping) return;
    housekeeping = setInterval(() => {
      for (const player of manager.players.values()) {
        const now = Date.now();
        const channel = client.guilds.cache.get(player.guildId)?.channels.cache.get(player.voiceChannelId);
        const occupied = channel?.members.some(member => !member.user.bot);
        if (occupied) emptySince.delete(player.guildId);
        else if (!emptySince.has(player.guildId)) emptySince.set(player.guildId, now);
        if (!player.paused) pausedSince.delete(player.guildId);
        else if (!pausedSince.has(player.guildId)) pausedSince.set(player.guildId, now);
        if (!store.getSettings(player.guildId).musicEnabled
          || (emptySince.has(player.guildId) && now - emptySince.get(player.guildId) >= IDLE_MS)
          || (pausedSince.has(player.guildId) && now - pausedSince.get(player.guildId) >= 600_000)) {
          player.destroy('IdleDisconnect').catch(error => failLog('music_idle_disconnect_failed', error));
        }
      }
    }, 30_000);
    housekeeping.unref();
  }
  async function handleRaw(payload) {
    if (!manager || closed || !['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE', 'CHANNEL_DELETE'].includes(payload?.t)) return;
    try { await manager.sendRawData(payload); } catch (error) { failLog('music_voice_update_failed', error); }
  }
  async function close() {
    closed = true; clearInterval(housekeeping);
    if (!manager) return;
    const results = await Promise.allSettled([...manager.players.values()].map(player => player.destroy('Shutdown')));
    for (const result of results) if (result.status === 'rejected') failLog('music_shutdown_failed', result.reason);
    for (const node of [...manager.nodeManager.nodes.values()]) node.destroy('Shutdown', true);
  }

  const definitions = [
    ['play', 'YouTube/YouTube Music’te ara veya YouTube/Spotify bağlantısı çal.'],
    ['pause', 'Çalan müziği duraklat.'], ['resume', 'Duraklatılan müziği devam ettir.'],
    ['skip', 'Geçerli parçayı atla.'], ['stop', 'Müziği durdur, kuyruğu temizle ve ses kanalından ayrıl.'],
    ['queue', 'Çalan parçayı ve müzik kuyruğunu göster.'], ['volume', 'Müzik ses seviyesini 0–100 arasında ayarla.'],
  ];
  const commands = definitions.map(([name, description]) => {
    const data = new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0);
    if (name === 'play') data.addStringOption(option => option.setName('sarki').setDescription('Şarkı adı veya YouTube/Spotify bağlantısı').setRequired(true).setMaxLength(500))
      .addStringOption(option => option.setName('kaynak').setDescription('Şarkı adıyla arama kaynağı').addChoices({ name: 'YouTube Music', value: 'ytmsearch' }, { name: 'YouTube', value: 'ytsearch' }));
    if (name === 'volume') data.addIntegerOption(option => option.setName('seviye').setDescription('0–100 arası ses seviyesi').setRequired(true).setMinValue(0).setMaxValue(100));
    return { data, async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content;
      try {
        if (name === 'queue') {
          const status = getStatus(interaction.guildId);
          const lines = status.queue.slice(0, 10).map((track, i) => `${i + 1}. ${escapeMarkdown(track.title.slice(0, 110))}`);
          content = `Şimdi: ${status.current ? escapeMarkdown(status.current.title.slice(0, 180)) : 'Çalan parça yok'}\nSes: %${status.volume} · Kuyruk: ${status.queue.length} parça${status.paused ? ' · Duraklatıldı' : ''}\n${lines.join('\n') || 'Kuyruk boş.'}`;
        } else {
          const result = await control(interaction.guildId, name, {
            query: name === 'play' ? interaction.options.getString('sarki', true) : undefined,
            source: name === 'play' ? interaction.options.getString('kaynak') || 'ytmsearch' : undefined,
            volume: name === 'volume' ? interaction.options.getInteger('seviye', true) : undefined,
            textChannelId: interaction.channelId,
          }, interaction.user.id);
          content = result.message;
        }
      } catch (error) {
        if (error instanceof MusicError) content = error.message;
        else { failLog('music_command_failed', error); content = 'Müzik işlemi tamamlanamadı. Biraz sonra tekrar deneyin.'; }
      }
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } };
  });
  return { commands, initialize, handleRaw, getStatus, control, applySettings, close };
}
