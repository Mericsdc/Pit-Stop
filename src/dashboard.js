import { createServer } from 'node:http';
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { safeError } from './logger.js';
import { rpgDashboard } from './rpg.js';
import { dashboardActivitySummary } from './dashboard-activity.js';

const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildInfo = process.env.PIT_STOP_BUILD || (await readFile(new URL('../BUILD_ID', import.meta.url), 'utf8').catch(() => 'development')).trim();
const manageGuild = PermissionFlagsBits.ManageGuild;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/rpg-view.js', ['rpg-view.js', 'text/javascript; charset=utf-8']],
  ['/site-config.js', ['site-config.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/layout.css', ['layout.css', 'text/css; charset=utf-8']],
  ['/assets/login-brand.png', ['assets/login-brand.png', 'image/png']],
  ['/assets/logo.webp', ['assets/logo.webp', 'image/webp']],
  ['/assets/banner.webp', ['assets/banner.webp', 'image/webp']],
]);

export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=')));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw httpError(415, 'JSON gövdesi gerekli.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw httpError(413, 'İstek çok büyük.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw httpError(400, 'Geçersiz JSON.'); }
}

export async function validateGuildSettings(guild, member, patch, existing = {}) {
  if (!patch || Array.isArray(patch) || typeof patch !== 'object') throw httpError(400, 'Ayarlar bir nesne olmalı.');
  for (const key of ['leaveChannelId', 'logChannelId', 'rpgAnnouncementChannelId', 'ticketChannelId', 'defenseChannelId', 'boostedEventChannelId', 'faqChannelId']) {
    if (!patch[key]) continue;
    const channel = await guild.channels.fetch(patch[key]);
    if (key === 'defenseChannelId' && channel?.type !== ChannelType.GuildText) throw httpError(400, 'Özel savunma thread’leri için normal bir metin kanalı seçin.');
    if (!channel || channel.guildId !== guild.id || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
      || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
      || !channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      throw httpError(400, 'Seçilen kanalda sizin görüntüleme, botun mesaj ve bağlantı gönderme izinleri olmalı.');
    }
  }
  const autoRoleIds = patch.autoRoleIds ?? (patch.autoRoleId !== undefined ? (patch.autoRoleId ? [patch.autoRoleId] : []) : existing.autoRoleIds || (existing.autoRoleId ? [existing.autoRoleId] : []));
  if (!Array.isArray(autoRoleIds) || autoRoleIds.length > 25) throw httpError(400, 'En fazla 25 rol seçilebilir.');
  if (patch.autoRoleIds || patch.autoRoleId || patch.autoRoleEnabled === true) for (const autoRoleId of autoRoleIds) {
    const role = await guild.roles.fetch(autoRoleId);
    if (!role || role.id === guild.id || role.managed || !role.editable
      || !member.permissions.has(PermissionFlagsBits.ManageRoles)
      || (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(role) <= 0)) {
      throw httpError(400, 'Otomatik rol, sizin ve botun yönetebileceği bir rol olmalı. Rolleri Yönet izni gerekli.');
    }
  }
  for (const id of [patch.djRoleId, patch.supportRoleId, ...(Array.isArray(patch.musicControllerRoleIds) ? patch.musicControllerRoleIds : []), ...(Array.isArray(patch.panelAccessRoleIds) ? patch.panelAccessRoleIds : [])].filter(Boolean)) {
    if (id === guild.id || !(await guild.roles.fetch(id))) throw httpError(400, 'Seçilen rol bulunamadı veya herkes rolü kullanılamaz.');
  }
  if (patch.ticketCategoryId) { const category = await guild.channels.fetch(patch.ticketCategoryId); if (category?.guildId !== guild.id || category.type !== ChannelType.GuildCategory) throw httpError(400, 'Geçerli bir kategori seçin.'); }
  const next = { ...existing, ...patch };
  if (next.ticketEnabled && (!next.ticketChannelId || !next.supportRoleId)) throw httpError(400, 'Bilet sistemi için kanal ve destek rolü seçin.');
  if (next.defenseEnabled && (!next.defenseChannelId || !next.supportRoleId)) throw httpError(400, 'Savunma sistemi için ana kanal ve destek rolü seçin.');
}

export function createDashboard({ client, store, music, features, crew, boostedEvents, config, logger = () => {}, fetcher = fetch }) {
  const sessions = new Map(), pendingStates = new Map(), limits = new Map(), weatherCache = new Map();
  const base = new URL(config.publicUrl);
  const secure = base.protocol === 'https:';
  const configured = Boolean(config.clientSecret && config.sessionSecret);
  const sessionStoreGuildId = config.allowedGuildIds?.[0] || config.clientId;
  const sessionKey = createHash('sha256').update(config.sessionSecret || 'unconfigured').digest();
  const sign = value => createHmac('sha256', config.sessionSecret || '').update(value).digest('base64url');
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const seal = value => {
    if (!value) return null;
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  };
  const open = value => {
    const [iv, tag, encrypted] = String(value || '').split('.');
    if (!iv || !tag || !encrypted) throw new Error('Geçersiz oturum verisi.');
    const decipher = createDecipheriv('aes-256-gcm', sessionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  };
  const saveSession = (id, session) => {
    if (!sessionStoreGuildId) return;
    store.putRecord(sessionStoreGuildId, 'panel_session', id, { user: session.user, csrf: session.csrf, authType: session.authType || 'oauth', guildId: session.guildId || null, accessToken: seal(session.accessToken), refreshToken: seal(session.refreshToken), accessExpires: session.accessExpires, expires: session.expires, createdAt: session.createdAt || Date.now(), seenGuilds: [...(session.seenGuilds || [])] });
  };
  const deleteSession = id => {
    sessions.delete(id);
    if (sessionStoreGuildId) store.deleteRecord(sessionStoreGuildId, 'panel_session', id);
  };
  const json = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  };
  const redirect = (response, location) => { response.writeHead(303, { Location: location }).end(); };
  const clean = () => {
    const now = Date.now();
    for (const map of [sessions, pendingStates, limits]) for (const [key, value] of map) if (value.expires <= now) {
      map.delete(key);
      if (map === sessions && sessionStoreGuildId) store.deleteRecord(sessionStoreGuildId, 'panel_session', key);
    }
    if (sessionStoreGuildId) for (const item of store.listRecords(sessionStoreGuildId, 'panel_session', 5000)) {
      if (!item.createdAt || item.expires <= now || item.expires > item.createdAt + 8 * 3600_000) {
        sessions.delete(item.id); store.deleteRecord(sessionStoreGuildId, 'panel_session', item.id);
      }
    }
    for (const [key, value] of weatherCache) if (value.expires <= now) weatherCache.delete(key);
  };
  const cleanup = setInterval(clean, 60_000);
  cleanup.unref();
  clean();

  async function discordApi(path, accessToken) {
    const response = await fetcher(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw httpError(response.status === 401 ? 401 : 502, 'Discord bilgileri alınamadı. Tekrar giriş yapmayı deneyin.');
    return response.json();
  }

  function getSession(request) {
    const raw = cookies(request.headers.cookie).pitstop_session;
    if (!raw) return undefined;
    const [legacyId, signature] = raw.split('.');
    const legacy = Boolean(legacyId && signature && constantEqual(signature, sign(legacyId)));
    const id = legacy ? legacyId : digest(raw);
    let session = sessions.get(id);
    if (!session && sessionStoreGuildId) {
      const saved = store.getRecord(sessionStoreGuildId, 'panel_session', id);
      if (saved) try {
        session = { user: saved.user, csrf: saved.csrf, authType: saved.authType || 'oauth', guildId: saved.guildId || null, accessToken: saved.accessToken ? open(saved.accessToken) : null, refreshToken: saved.refreshToken ? open(saved.refreshToken) : null, accessExpires: saved.accessExpires || saved.expires, expires: saved.expires, createdAt: saved.createdAt, seenGuilds: new Set(saved.seenGuilds || []) };
        sessions.set(id, session);
      } catch { store.deleteRecord(sessionStoreGuildId, 'panel_session', id); }
    }
    if (!session || session.expires <= Date.now()) { deleteSession(id); return undefined; }
    return { id, ...session };
  }

  async function currentAccessToken(session) {
    if (session.authType === 'code') throw httpError(401, 'Bu oturum Discord koduyla açıldı.');
    if (!session.accessExpires || session.accessExpires > Date.now() + 60_000) return session.accessToken;
    if (!session.refreshToken) { deleteSession(session.id); throw httpError(401, 'Discord oturumunuzun süresi doldu. Yeniden giriş yapın.'); }
    const tokenResponse = await fetcher('https://discord.com/api/v10/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) { deleteSession(session.id); throw httpError(401, 'Discord oturumunuz yenilenemedi. Yeniden giriş yapın.'); }
    const token = await tokenResponse.json(), live = sessions.get(session.id) || session;
    live.accessToken = token.access_token;
    live.refreshToken = token.refresh_token || live.refreshToken;
    live.accessExpires = Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000;
    sessions.set(session.id, live);
    saveSession(session.id, live);
    return live.accessToken;
  }

  async function authorizedGuild(guildId, session) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw httpError(404, 'Bot bu sunucuda bulunamadı.');
    let member;
    try { member = await guild.members.fetch({ user: session.user.id, force: true }); }
    catch { throw httpError(403, 'Bu sunucuyu yönetme yetkiniz yok.'); }
    const settings = store.getSettings(guildId);
    const hasPanelRole = (settings.panelAccessRoleIds || []).some(roleId => member.roles.cache.has(roleId));
    if (!member.permissions.has(manageGuild) && !hasPanelRole) {
      if (session.authType === 'code' || session.seenGuilds?.has(guildId)) deleteSession(session.id);
      throw httpError(403, 'Panel erişim rolünüz bulunmuyor.');
    }
    if (session.authType === 'code' && session.guildId !== guildId) throw httpError(403, 'Bu oturum başka bir sunucu için oluşturuldu.');
    return { guild, member };
  }

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; media-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url, base);
      if (staticFiles.has(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
        const [file, type] = staticFiles.get(url.pathname);
        const body = await readFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)));
        response.writeHead(200, { 'Content-Type': type });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const publicSettings = sessionStoreGuildId ? store.getSettings(sessionStoreGuildId) : {};
        json(response, 200, { name: 'Pit-Stop', ready: client.isReady(), loginConfigured: configured, version: packageInfo.version, build: buildInfo || basename(process.cwd()), codeLogin: true, appearance: { panelLogoUrl: publicSettings.panelLogoUrl, panelBannerUrl: publicSettings.panelBannerUrl, panelLoginBackgroundUrl: publicSettings.panelLoginBackgroundUrl } });
        return;
      }
      const session = getSession(request);
      const rateKey = session?.id || request.socket.remoteAddress;
      let bucket = limits.get(rateKey);
      if (!bucket || bucket.expires <= Date.now()) {
        if (limits.size >= 10_000) clean();
        if (limits.size >= 10_000) throw httpError(429, 'Lütfen daha sonra tekrar deneyin.');
        bucket = { expires: Date.now() + 60_000, count: 0 };
        limits.set(rateKey, bucket);
      }
      if (++bucket.count > (session ? 120 : 30)) throw httpError(429, 'Çok fazla istek. Bir dakika sonra tekrar deneyin.');

      if (url.pathname === '/api/weather' && request.method === 'GET') {
        const latitude = url.searchParams.has('lat') ? Number(url.searchParams.get('lat')) : Number.NaN;
        const longitude = url.searchParams.has('lon') ? Number(url.searchParams.get('lon')) : Number.NaN;
        let lat = latitude, lon = longitude, city = config.weather?.city || 'İstanbul';
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { lat = Number(config.weather?.latitude) || 41.0082; lon = Number(config.weather?.longitude) || 28.9784; }
        const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`, cached = weatherCache.get(cacheKey);
        if (cached?.expires > Date.now()) { json(response, 200, cached.value); return; }
        const weatherResponse = await fetcher(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`, { signal: AbortSignal.timeout(6000) });
        if (!weatherResponse.ok) throw httpError(503, 'Hava durumu şu anda kullanılamıyor.');
        const weather = await weatherResponse.json();
        const names = { 0: 'Açık', 1: 'Çoğunlukla açık', 2: 'Parçalı bulutlu', 3: 'Kapalı', 45: 'Sisli', 48: 'Kırağılı sis', 51: 'Hafif çiseleme', 53: 'Çiseleme', 55: 'Yoğun çiseleme', 61: 'Hafif yağmur', 63: 'Yağmurlu', 65: 'Kuvvetli yağmur', 71: 'Hafif kar', 73: 'Karlı', 75: 'Yoğun kar', 80: 'Sağanak', 81: 'Sağanak', 82: 'Kuvvetli sağanak', 95: 'Gök gürültülü' };
        if (Number.isFinite(latitude)) city = 'Konumunuz';
        const value = { city, temperature: weather.current?.temperature_2m, apparent: weather.current?.apparent_temperature, description: names[weather.current?.weather_code] || 'Değişken', code: weather.current?.weather_code };
        weatherCache.set(cacheKey, { value, expires: Date.now() + 10 * 60_000 });
        json(response, 200, value);
        return;
      }

      if (url.pathname === '/auth/code' && request.method === 'POST') {
        if (request.headers.origin !== base.origin) throw httpError(403, 'Giriş isteği doğrulanamadı.');
        const body = await readJson(request);
        const supplied = typeof body.code === 'string' ? body.code.trim() : '';
        if (!/^[A-Za-z0-9_-]{40,64}$/u.test(supplied)) {
          if (sessionStoreGuildId) store.addLog(sessionStoreGuildId, { type: 'panel.login_failed', message: 'Geçersiz biçimde panel giriş kodu denendi.', details: { ipHash: digest(request.socket.remoteAddress || '').slice(0, 16) } });
          throw httpError(401, 'Giriş kodu geçersiz, kullanılmış veya süresi dolmuş.');
        }
        let codeRecord;
        for (const guild of client.guilds.cache.values()) {
          codeRecord = store.consumeRecord(guild.id, 'panel_login_code', digest(supplied));
          if (codeRecord) break;
        }
        if (!codeRecord) {
          if (sessionStoreGuildId) store.addLog(sessionStoreGuildId, { type: 'panel.login_failed', message: 'Geçersiz, kullanılmış veya süresi dolmuş panel kodu denendi.', details: { ipHash: digest(request.socket.remoteAddress || '').slice(0, 16) } });
          throw httpError(401, 'Giriş kodu geçersiz, kullanılmış veya süresi dolmuş.');
        }
        const guild = client.guilds.cache.get(codeRecord.guildId);
        const member = await guild?.members.fetch({ user: codeRecord.userId, force: true }).catch(() => null);
        const settings = guild ? store.getSettings(guild.id) : null;
        const allowed = member && (member.permissions.has(manageGuild) || (settings.panelAccessRoleIds || []).some(id => member.roles.cache.has(id)));
        if (!allowed) {
          store.addLog(codeRecord.guildId, { type: 'panel.login_failed', actorId: codeRecord.userId, message: 'Panel giriş kodu rol doğrulamasından geçemedi.', details: { actorName: codeRecord.userName } });
          throw httpError(401, 'Giriş kodu geçersiz, kullanılmış veya süresi dolmuş.');
        }
        const rawSession = random(), id = digest(rawSession);
        const seconds = Math.min(8, Math.max(1, Number(settings.panelSessionHours) || 8)) * 3600;
        const user = member.user;
        const created = { user: { id: user.id, username: user.username, name: user.globalName || user.username, avatar: user.avatar }, authType: 'code', guildId: guild.id, csrf: random(), expires: Date.now() + seconds * 1000, createdAt: Date.now(), seenGuilds: new Set() };
        sessions.set(id, created); saveSession(id, created);
        store.addLog(guild.id, { type: 'panel.login', actorId: user.id, message: `${created.user.name} tek kullanımlık kodla panele giriş yaptı.`, details: { actorName: created.user.name, method: 'one_time_code' } });
        response.setHeader('Set-Cookie', cookie('pitstop_session', rawSession, seconds));
        json(response, 200, { ok: true }); return;
      }

      if (url.pathname === '/auth/login' && request.method === 'GET') {
        if (!configured) throw httpError(503, 'Panel girişi için Discord OAuth2 bilgileri henüz ayarlanmadı.');
        clean();
        if (pendingStates.size >= 1000) throw httpError(429, 'Lütfen daha sonra tekrar deneyin.');
        const state = random(), interactive = url.searchParams.get('interactive') === '1';
        pendingStates.set(state, { expires: Date.now() + 300_000, interactive });
        response.setHeader('Set-Cookie', cookie('pitstop_state', state, 300));
        const target = new URL('https://discord.com/oauth2/authorize');
        target.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', scope: 'identify guilds', redirect_uri: `${base.origin}/auth/callback`, state, ...(interactive ? {} : { prompt: 'none' }) });
        redirect(response, target.href);
        return;
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state');
        const pending = pendingStates.get(state);
        const valid = pending?.expires > Date.now() && constantEqual(state, cookies(request.headers.cookie).pitstop_state);
        pendingStates.delete(state);
        response.setHeader('Set-Cookie', cookie('pitstop_state', '', 0));
        if (!configured || !valid) throw httpError(400, 'Giriş doğrulaması geçersiz veya süresi doldu. Yeniden giriş yapın.');
        if (url.searchParams.has('error') || !url.searchParams.get('code')) { redirect(response, pending.interactive ? '/?login=cancelled' : '/auth/login?interactive=1'); return; }
        const tokenResponse = await fetcher('https://discord.com/api/v10/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: `${base.origin}/auth/callback` }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenResponse.ok) throw httpError(502, 'Discord oturumu açılamadı. Tekrar deneyin.');
        const token = await tokenResponse.json();
        const user = await discordApi('/users/@me', token.access_token);
        clean();
        if (sessions.size >= 1000) throw httpError(503, 'Oturum kapasitesi dolu. Daha sonra deneyin.');
        const rawSession = random(), id = digest(rawSession);
        const accessSeconds = Math.max(60, Number(token.expires_in) || 3600);
        const seconds = 8 * 3600;
        const created = { user: { id: user.id, username: user.username, name: user.global_name || user.username, avatar: user.avatar }, authType: 'oauth', accessToken: token.access_token, refreshToken: token.refresh_token || null, csrf: random(), accessExpires: Date.now() + accessSeconds * 1000, expires: Date.now() + seconds * 1000, createdAt: Date.now(), seenGuilds: new Set() };
        sessions.set(id, created);
        saveSession(id, created);
        response.setHeader('Set-Cookie', [cookie('pitstop_state', '', 0), cookie('pitstop_session', rawSession, seconds)]);
        redirect(response, '/');
        return;
      }
      if (!session) throw httpError(401, 'Discord hesabınızla giriş yapın.');
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.origin !== base.origin || !constantEqual(request.headers['x-csrf-token'], session.csrf)) throw httpError(403, 'İstek doğrulanamadı. Sayfayı yenileyin.');
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        deleteSession(session.id);
        response.setHeader('Set-Cookie', cookie('pitstop_session', '', 0));
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        json(response, 200, { user: session.user, csrf: session.csrf, installationOwner: config.ownerIds?.includes(session.user.id) || false });
        return;
      }
      if (url.pathname === '/api/guilds' && request.method === 'GET') {
        if (session.authType === 'code') {
          const guild = client.guilds.cache.get(session.guildId);
          json(response, 200, guild ? [{ id: guild.id, name: guild.name, icon: guild.icon }] : []); return;
        }
        const guilds = await discordApi('/users/@me/guilds', await currentAccessToken(session));
        json(response, 200, guilds.filter(guild => client.guilds.cache.has(guild.id) && (guild.owner || (BigInt(guild.permissions) & (manageGuild | PermissionFlagsBits.Administrator)) !== 0n)).map(guild => ({ id: guild.id, name: guild.name, icon: guild.icon })));
        return;
      }
      const match = /^\/api\/guilds\/(\d{17,20})(?:\/(settings|logs|music|blacklist|reminders|tickets|cases|protection|access|panel-access|crew|faqs|boosted-event|reaction-roles|rpg))?$/.exec(url.pathname);
      if (!match) throw httpError(404, 'Sayfa bulunamadı.');
      const [, guildId, resource] = match;
      const { guild, member } = await authorizedGuild(guildId, session);
      if (resource === 'rpg' && request.method === 'GET') { json(response, 200, rpgDashboard(store, guildId)); return; }
      if (!resource && request.method === 'GET') {
        await Promise.all([guild.channels.fetch(), guild.roles.fetch(), guild.emojis?.fetch?.() || Promise.resolve()]);
        const me = guild.members.me;
        const botPermissions = me?.permissions;
        const visibleChannels = [...guild.channels.cache.values()].filter(channel => channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel));
        const channelNames = new Map(visibleChannels.map(channel => [channel.id, channel.name]));
        const activity = dashboardActivitySummary(store, guildId, channelNames);
        const onlineCount = guild.members.cache?.filter?.(item => item.presence?.status && item.presence.status !== 'offline').size || 0;
        const voiceChannels = visibleChannels.filter(channel => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type));
        const voiceMemberCount = voiceChannels.reduce((total, channel) => total + Number(channel.members?.size || 0), 0);
        const activeVoiceChannelCount = voiceChannels.filter(channel => Number(channel.members?.size || 0) > 0).length;
        if (!session.seenGuilds?.has(guildId)) {
          const live = sessions.get(session.id); live.seenGuilds ??= new Set(); live.seenGuilds.add(guildId); saveSession(session.id, live);
          store.addLog(guildId, { type: 'panel.login', actorId: session.user.id, message: `${session.user.name} yönetim paneline giriş yaptı.`, details: { actorName: session.user.name } });
        }
        json(response, 200, {
          id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount,
          channels: visibleChannels.filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildCategory].includes(channel.type)).map(channel => ({ id: channel.id, name: channel.name, type: channel.type })),
          roles: [...guild.roles.cache.values()].filter(role => role.id !== guild.id).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor, assignable: role.editable && !role.managed && member.permissions.has(PermissionFlagsBits.ManageRoles) && (member.id === guild.ownerId || member.roles.highest.comparePositionTo(role) > 0) })),
          emojis: guild.emojis ? [...guild.emojis.cache.values()].filter(emoji => emoji.available !== false).map(emoji => ({ id: emoji.id, name: emoji.name, animated: emoji.animated || false })) : [],
          reactionRoleCount: store.listRecords(guildId, 'reaction_role', 500).length,
          settings: store.getSettings(guildId), music: music.getStatus(guildId),
          boostedEvent: boostedEvents?.getStatus(guildId) || null,
          protection: features?.protectionStatus(), presenceEnabled: config.presenceEnabled || false,
          viewerPermissions: { manageChannels: member.permissions.has(PermissionFlagsBits.ManageChannels) },
          dashboard: { onlineCount, offlineCount: Math.max(0, guild.memberCount - onlineCount), voiceMemberCount, activeVoiceChannelCount, ...activity },
          bot: { ready: client.isReady(), ping: Math.max(0, Math.round(client.ws.ping)), uptime: Math.round(process.uptime()), permissions: Object.fromEntries(Object.entries({ manageRoles: PermissionFlagsBits.ManageRoles, manageMessages: PermissionFlagsBits.ManageMessages, addReactions: PermissionFlagsBits.AddReactions, connect: PermissionFlagsBits.Connect, speak: PermissionFlagsBits.Speak, moderateMembers: PermissionFlagsBits.ModerateMembers, viewAuditLog: PermissionFlagsBits.ViewAuditLog, manageChannels: PermissionFlagsBits.ManageChannels, createPrivateThreads: PermissionFlagsBits.CreatePrivateThreads, manageThreads: PermissionFlagsBits.ManageThreads }).map(([key, flag]) => [key, botPermissions?.has(flag) || false])) },
        });
        return;
      }
      if (resource === 'settings' && request.method === 'PUT') {
        const patch = await readJson(request);
        const previous = store.getSettings(guildId);
        await validateGuildSettings(guild, member, patch, previous);
        let settings;
        try { settings = store.updateSettings(guildId, patch); }
        catch (error) { throw httpError(400, error.message); }
        store.addLog(guildId, { type: 'settings.updated', actorId: session.user.id, message: `${session.user.name} bot ayarlarını güncelledi.`, details: { actorName: session.user.name, fields: Object.keys(patch) } });
        for (const key of Object.keys(patch)) if (JSON.stringify(previous[key]) !== JSON.stringify(settings[key])) {
          const preview = value => {
            let result = JSON.stringify(value) ?? '';
            while (JSON.stringify(result).length > 1500) result = result.slice(0, Math.floor(result.length * 0.8));
            return result;
          };
          store.addLog(guildId, { type: 'settings.detail', actorId: session.user.id, message: `${session.user.name}: ${key} değiştirildi.`, details: { actorName: session.user.name, field: key, before: preview(previous[key]), after: preview(settings[key]) } });
        }
        await music.applySettings(guildId);
        json(response, 200, settings);
        return;
      }
      if (resource === 'logs' && request.method === 'GET') {
        const logs = store.getLogs(guildId, { limit: 50, before: url.searchParams.get('before') || undefined, type: url.searchParams.get('type') || undefined });
        const ids = [...new Set(logs.filter(log => log.actorId && !log.details.actorName).map(log => log.actorId))];
        const names = new Map(await Promise.all(ids.map(async id => { const user = client.users?.cache.get(id) || await client.users?.fetch(id).catch(() => null); return [id, user?.globalName || user?.username]; })));
        json(response, 200, logs.map(log => ({ ...log, actorName: log.details.actorName || names.get(log.actorId) || null })));
        return;
      }
      if (resource === 'protection' && request.method === 'GET') { json(response, 200, features?.protectionStatus() || {}); return; }
      if (resource === 'crew' && request.method === 'GET') { json(response, 200, crew?.getStatus(guildId) || { enabled: false, members: [], error: 'Crew takibi kullanılamıyor.' }); return; }
      if (resource === 'crew' && request.method === 'POST') {
        if (!crew) throw httpError(503, 'Crew takibi kullanılamıyor.');
        json(response, 200, await crew.refresh(guildId, true, { log: true, actorId: session.user.id, actorName: session.user.name })); return;
      }
      if (resource === 'boosted-event' && ['GET', 'POST'].includes(request.method)) {
        if (!boostedEvents) throw httpError(503, 'Boosted Event izleyicisi kullanılamıyor.');
        json(response, 200, request.method === 'POST' ? await boostedEvents.refresh(guildId, true) : boostedEvents.getStatus(guildId)); return;
      }
      if (resource === 'reaction-roles') {
        if (request.method === 'GET') { json(response, 200, store.listRecords(guildId, 'reaction_role', 500)); return; }
        const body = await readJson(request);
        if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) throw httpError(403, 'Emoji ile rol vermeyi yönetmek için Rolleri Yönet izni gerekli.');
        if (request.method === 'POST') {
          if (typeof body.channelId !== 'string' || !/^\d{17,20}$/u.test(body.channelId)) throw httpError(400, 'Bir yayın kanalı seçin.');
          if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 1800) throw httpError(400, 'Mesaj 1–1800 karakter arasında olmalı.');
          if (!Array.isArray(body.mappings) || body.mappings.length < 1 || body.mappings.length > 20) throw httpError(400, '1–20 emoji ve rol eşleştirmesi ekleyin.');
          const channel = await guild.channels.fetch(body.channelId).catch(() => null);
          const requiredBotPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ManageRoles];
          if (!channel || channel.guildId !== guild.id || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
            || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
            || !channel.permissionsFor(guild.members.me)?.has(requiredBotPermissions)) {
            throw httpError(400, 'Seçilen kanalda botun mesaj okuma, gönderme, tepki ekleme ve rol yönetme izinleri olmalı.');
          }

          const seen = new Set(), seenRoles = new Set();
          const segmenter = new Intl.Segmenter('tr', { granularity: 'grapheme' });
          const mappings = [];
          for (const raw of body.mappings) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.emoji !== 'string' || typeof raw.roleId !== 'string') throw httpError(400, 'Her satırda geçerli bir emoji ve rol seçin.');
            const role = await guild.roles.fetch(raw.roleId).catch(() => null);
            if (!role || role.id === guild.id || role.managed || !role.editable || (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(role) <= 0)) {
              throw httpError(400, 'Seçilen roller sizin ve botun yönetebileceği roller olmalı.');
            }
            if (seenRoles.has(role.id)) throw httpError(400, 'Aynı rol bir mesajda yalnızca bir tepkiye bağlanabilir.');
            seenRoles.add(role.id);
            let mapping;
            if (raw.emoji.startsWith('custom:')) {
              const id = raw.emoji.slice(7);
              if (!/^\d{17,20}$/u.test(id)) throw httpError(400, 'Geçersiz sunucu emojisi.');
              const emoji = guild.emojis?.cache.get(id) || await guild.emojis?.fetch?.(id).catch(() => null);
              if (!emoji || emoji.guild?.id && emoji.guild.id !== guild.id || emoji.available === false) throw httpError(400, 'Seçilen sunucu emojisi kullanılamıyor.');
              mapping = { key: `custom:${emoji.id}`, label: `:${emoji.name}:`, reaction: emoji.id, emojiId: emoji.id, emojiName: emoji.name, animated: emoji.animated || false, roleId: role.id, roleName: role.name };
            } else if (raw.emoji.startsWith('unicode:')) {
              const emoji = raw.emoji.slice(8).trim();
              if (!emoji || emoji.length > 32 || [...segmenter.segment(emoji)].length !== 1 || /^[\p{L}\p{N}]$/u.test(emoji)) throw httpError(400, 'Geçerli bir emoji seçin.');
              mapping = { key: `unicode:${emoji}`, label: emoji, reaction: emoji, emoji: emoji, roleId: role.id, roleName: role.name };
            } else throw httpError(400, 'Listeden bir emoji seçin.');
            if (seen.has(mapping.key)) throw httpError(400, 'Aynı emoji bir mesajda yalnızca bir role bağlanabilir.');
            seen.add(mapping.key);
            mappings.push(mapping);
          }

          let sent;
          try {
            sent = await channel.send({ content: body.content.trim(), allowedMentions: { parse: [] } });
            for (const mapping of mappings) await sent.react(mapping.reaction);
          } catch (error) {
            if (sent) await sent.delete().catch(() => {});
            logger('warn', 'reaction_role_publish_failed', safeError(error));
            throw httpError(409, 'Mesaj veya tepkiler yayımlanamadı. Bot izinlerini ve emojileri kontrol edin.');
          }
          const record = { channelId: channel.id, channelName: channel.name, content: body.content.trim(), mappings, createdAt: Date.now(), createdBy: session.user.id, createdByName: session.user.name };
          store.putRecord(guildId, 'reaction_role', sent.id, record);
          store.addLog(guildId, { type: 'reaction_role.published', actorId: session.user.id, message: `${session.user.name} emoji ile rol mesajı yayımladı.`, details: { actorName: session.user.name, channelId: channel.id, messageId: sent.id, mappings: mappings.map(item => ({ emoji: item.label, roleId: item.roleId, roleName: item.roleName })) } });
          json(response, 200, store.getRecord(guildId, 'reaction_role', sent.id)); return;
        }
        if (request.method === 'DELETE') {
          if (typeof body.id !== 'string' || !body.id) throw httpError(400, 'Yayın kimliği gerekli.');
          const item = store.getRecord(guildId, 'reaction_role', body.id);
          if (!item) throw httpError(404, 'Emoji rolü yayını bulunamadı.');
          const channel = await guild.channels.fetch(item.channelId).catch(() => null);
          const message = await channel?.messages?.fetch(body.id).catch(() => null);
          if (message) await message.delete().catch(() => { throw httpError(409, 'Discord mesajı silinemedi. Bot izinlerini kontrol edin.'); });
          store.deleteRecord(guildId, 'reaction_role', body.id);
          store.addLog(guildId, { type: 'reaction_role.deleted', actorId: session.user.id, message: `${session.user.name} emoji ile rol yayınını kaldırdı.`, details: { actorName: session.user.name, channelId: item.channelId, messageId: body.id } });
          json(response, 200, { ok: true }); return;
        }
        throw httpError(405, 'Geçersiz emoji rolü işlemi.');
      }
      if (resource === 'faqs') {
        if (request.method === 'GET') { json(response, 200, store.listRecords(guildId, 'faq', 500)); return; }
        const body = await readJson(request);
        const normalized = value => value.normalize('NFKC').trim().toLocaleLowerCase('tr-TR').replace(/\s+/gu, ' ');
        if (['POST', 'PUT'].includes(request.method)) {
          if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 300) throw httpError(400, 'Soru 1–300 karakter arasında olmalı.');
          if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 1800) throw httpError(400, 'Cevap 1–1800 karakter arasında olmalı.');
          if (request.method === 'POST' && store.listRecords(guildId, 'faq', 500).some(item => normalized(item.question || '') === normalized(body.question))) throw httpError(409, 'Aynı soru daha önce eklenmiş. Mevcut kaydı düzenleyin veya farklı bir soru yazın.');
        }
        if (request.method === 'POST') {
          if (body.draft === true) {
            const id = random();
            store.putRecord(guildId, 'faq', id, { question: body.question.trim(), answer: body.answer.trim(), status: 'draft', createdAt: Date.now(), createdBy: session.user.id, createdByName: session.user.name });
            store.addLog(guildId, { type: 'faq.draft_created', actorId: session.user.id, message: `${session.user.name} bir SSS taslağı kaydetti.`, details: { actorName: session.user.name, id, question: body.question.trim() } });
            json(response, 200, store.getRecord(guildId, 'faq', id)); return;
          }
          try { json(response, 200, await features.publishFaq(guild, member, session.user, body.question, body.answer)); }
          catch (error) { throw httpError(400, error.message); }
          return;
        }
        if (request.method === 'PUT') {
          if (typeof body.id !== 'string' || !body.id) throw httpError(400, 'SSS kaydı kimliği gerekli.');
          const item = store.getRecord(guildId, 'faq', body.id);
          if (!item) throw httpError(404, 'SSS kaydı bulunamadı.');
          const question = body.question.trim(), answer = body.answer.trim();
          const questionChanged = normalized(item.question || '') !== normalized(question);
          if (questionChanged && store.listRecords(guildId, 'faq', 500).some(record => String(record.id) !== String(body.id) && normalized(record.question || '') === normalized(question))) throw httpError(409, 'Aynı soru daha önce eklenmiş. Mevcut kaydı düzenleyin veya farklı bir soru yazın.');
          if (item.channelId && item.messageId) {
            const channel = await guild.channels.fetch(item.channelId).catch(() => null);
            const message = await channel?.messages?.fetch(item.messageId).catch(() => null);
            if (!message) throw httpError(409, 'Yayımlanmış Discord mesajı bulunamadı. Kaydı kaldırıp yeniden yayımlayın.');
            await message.edit({ content: `❓ **${question}**\n${answer}`, allowedMentions: { parse: [] } }).catch(() => { throw httpError(409, 'Discord mesajı güncellenemedi; bot izinlerini kontrol edin.'); });
          }
          store.putRecord(guildId, 'faq', body.id, { ...item, question, answer, status: item.channelId && item.messageId ? 'published' : (item.status || 'draft'), updatedAt: Date.now(), updatedBy: session.user.id, updatedByName: session.user.name });
          store.addLog(guildId, { type: 'faq.updated', actorId: session.user.id, message: `${session.user.name} bir SSS kaydını düzenledi.`, details: { actorName: session.user.name, id: body.id, before: { question: item.question, answer: item.answer }, after: { question, answer }, messageId: item.messageId || null } });
          json(response, 200, store.getRecord(guildId, 'faq', body.id)); return;
        }
        if (request.method === 'DELETE') {
          if (typeof body.id !== 'string' || !body.id) throw httpError(400, 'SSS kaydı kimliği gerekli.');
          const item = store.getRecord(guildId, 'faq', body.id);
          if (!item) throw httpError(404, 'SSS kaydı bulunamadı.');
          if (body.deleteDiscordMessage === true && item.channelId && item.messageId) {
            const channel = await guild.channels.fetch(item.channelId).catch(() => null);
            const message = await channel?.messages?.fetch(item.messageId).catch(() => null);
            if (message) await message.delete().catch(() => { throw httpError(409, 'Discord mesajı silinemedi; bot izinlerini kontrol edin.'); });
          }
          store.deleteRecord(guildId, 'faq', body.id);
          store.addLog(guildId, { type: 'faq.deleted', actorId: session.user.id, message: `${session.user.name} SSS kaydını sildi.`, details: { actorName: session.user.name, id: body.id, question: item.question } });
          json(response, 200, { ok: true }); return;
        }
        throw httpError(405, 'Geçersiz SSS işlemi.');
      }
      if (resource === 'blacklist') {
        if (request.method === 'GET') { json(response, 200, store.listRecords(guildId, 'blacklist', 10000)); return; }
        const body = await readJson(request);
        if (!/^[1-9]\d{16,19}$/.test(body.userId || '')) throw httpError(400, 'Geçerli kullanıcı kimliği girin.');
        if (request.method === 'POST') {
          const user = await client.users.fetch(body.userId).catch(() => null);
          if (!user) throw httpError(400, 'Discord kullanıcısı bulunamadı.');
          if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) throw httpError(400, '1–1000 karakterlik sebep girin.');
          store.putRecord(guildId, 'blacklist', user.id, { name: user.globalName || user.username, reason: body.reason, source: 'manual', createdAt: Date.now(), addedBy: session.user.id, addedByName: session.user.name });
        } else if (request.method === 'DELETE') store.deleteRecord(guildId, 'blacklist', body.userId);
        else throw httpError(405, 'Geçersiz işlem.');
        store.addLog(guildId, { type: 'blacklist.updated', actorId: session.user.id, message: `${session.user.name} kara liste kaydını ${request.method === 'POST' ? 'ekledi' : 'kaldırdı'}.`, details: { actorName: session.user.name, userId: body.userId, reason: body.reason } });
        json(response, 200, { ok: true }); return;
      }
      if (['reminders', 'tickets', 'cases'].includes(resource)) {
        const kind = { reminders: 'reminder', tickets: 'ticket', cases: 'case' }[resource];
        if (request.method === 'GET') {
          let items = store.listRecords(guildId, kind, 1000);
          if (kind === 'reminder') items = items.map(item => ({ ...item, text: item.userId === session.user.id || item.destination === 'channel' ? item.text : '(Kişisel DM notu)' }));
          json(response, 200, items); return;
        }
        if (resource === 'tickets' && request.method === 'POST') { try { await features.publishTicket(guild, session.user.id); } catch (error) { throw httpError(400, error.message); } json(response, 200, { ok: true }); return; }
        if (request.method === 'DELETE') {
          const body = await readJson(request), item = store.getRecord(guildId, kind, body.id);
          if (!item) throw httpError(404, 'Kayıt bulunamadı.');
          if (kind === 'ticket' && ![undefined, 'close', 'delete'].includes(body.action)) throw httpError(400, 'Geçersiz destek bileti işlemi.');
          if (kind === 'reminder' && item.userId !== session.user.id) throw httpError(403, 'Yalnızca kendi hatırlatıcınızı iptal edebilirsiniz.');
          if (kind === 'reminder') store.deleteRecord(guildId, kind, body.id);
          else {
            const channel = await guild.channels.fetch(item.id).catch(() => null);
            if (kind === 'case' && channel) { await channel.setLocked(true, 'Panelden kapatıldı'); await channel.setArchived(true, 'Panelden kapatıldı'); }
            if (kind === 'ticket' && body.action === 'delete') {
              if (!channel) throw httpError(404, 'Destek kanalı bulunamadı.');
              try { await features.deleteTicket(guildId, channel, { id: session.user.id, user: session.user, member }); }
              catch (error) { throw httpError(403, error.message); }
            } else if (kind === 'ticket' && channel) await features.closeTicket(guildId, channel, { id: session.user.id, user: session.user, member });
            else store.putRecord(guildId, kind, item.id, { ...item, status: 'closed', closedAt: Date.now(), closedBy: session.user.id, closedByName: session.user.name });
          }
          if (kind !== 'ticket') store.addLog(guildId, { type: `${kind}.closed`, actorId: session.user.id, message: `${session.user.name} kaydı kapattı.`, details: { actorName: session.user.name, id: body.id } });
          json(response, 200, { ok: true }); return;
        }
      }
      if (resource === 'access') {
        if (!config.ownerIds?.includes(session.user.id)) throw httpError(403, 'Yalnızca bot sahibi kurulum izinlerini düzenleyebilir.');
        const home = config.allowedGuildIds?.[0];
        if (!home) throw httpError(400, 'Sunucuda ALLOWED_GUILD_IDS yapılandırılmalı.');
        if (request.method === 'GET') { json(response, 200, store.getRecord(home, 'install_policy', 'current') || { guildIds: config.allowedGuildIds }); return; }
        if (request.method === 'PUT') {
          const body = await readJson(request);
          if (!Array.isArray(body.guildIds) || body.guildIds.length > 25 || !body.guildIds.includes(home) || body.guildIds.some(id => typeof id !== 'string' || !/^[1-9]\d{16,19}$/.test(id))) throw httpError(400, 'Ana sunucu korunmalı; en fazla 25 geçerli sunucu kimliği girilebilir.');
          store.putRecord(home, 'install_policy', 'current', { guildIds: [...new Set(body.guildIds)] });
          store.addLog(home, { type: 'access.updated', actorId: session.user.id, message: 'Bot sahibi izin verilen kurulum sunucularını güncelledi.', details: { actorName: session.user.name, guildIds: body.guildIds } });
          json(response, 200, { ok: true }); return;
        }
      }
      if (resource === 'panel-access') {
        const records = store.listRecords(sessionStoreGuildId, 'panel_session', 5000)
          .filter(item => item.expires > Date.now() && (item.guildId === guildId || item.seenGuilds?.includes(guildId)));
        if (request.method === 'GET') {
          json(response, 200, { activeCount: records.length, sessions: records.map(item => ({ user: item.user, authType: item.authType || 'oauth', createdAt: item.createdAt, expires: item.expires })) }); return;
        }
        if (request.method === 'DELETE') {
          for (const item of records) deleteSession(item.id);
          store.addLog(guildId, { type: 'panel.sessions_revoked', actorId: session.user.id, message: `${session.user.name} tüm panel oturumlarını kapattı.`, details: { actorName: session.user.name, count: records.length } });
          response.setHeader('Set-Cookie', cookie('pitstop_session', '', 0));
          json(response, 200, { ok: true, revoked: records.length }); return;
        }
        throw httpError(405, 'Geçersiz panel erişimi işlemi.');
      }
      if (resource === 'music' && request.method === 'GET') { json(response, 200, music.getStatus(guildId)); return; }
      if (resource === 'music' && request.method === 'POST') {
        const body = await readJson(request);
        if (!['play', 'pause', 'resume', 'skip', 'stop', 'volume'].includes(body.action)) throw httpError(400, 'Geçersiz müzik işlemi.');
        try {
          await music.control(guildId, body.action, { query: body.query, volume: body.volume }, session.user.id);
        } catch (error) { throw httpError(400, error.userMessage || 'Müzik işlemi tamamlanamadı. Botla aynı ses kanalında olduğunuzu ve müzik bağlantısını kontrol edin.'); }
        json(response, 200, music.getStatus(guildId));
        return;
      }
      throw httpError(405, 'Bu işlem desteklenmiyor.');
    } catch (error) {
      if (!error.status || error.status >= 500) logger('error', 'dashboard_error', safeError(error));
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'İşlem tamamlanamadı. Tekrar deneyin.' });
      else response.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); pendingStates.clear(); weatherCache.clear(); });
  return server;
}
