import { createServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { safeError } from './logger.js';

const random = () => randomBytes(32).toString('base64url');
const manageGuild = PermissionFlagsBits.ManageGuild;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/site-config.js', ['site-config.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
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
  for (const key of ['leaveChannelId', 'logChannelId', 'ticketChannelId', 'defenseChannelId']) {
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
  for (const id of [patch.djRoleId, patch.supportRoleId, ...(Array.isArray(patch.musicControllerRoleIds) ? patch.musicControllerRoleIds : [])].filter(Boolean)) {
    if (id === guild.id || !(await guild.roles.fetch(id))) throw httpError(400, 'Seçilen rol bulunamadı veya herkes rolü kullanılamaz.');
  }
  if (patch.ticketCategoryId) { const category = await guild.channels.fetch(patch.ticketCategoryId); if (category?.guildId !== guild.id || category.type !== ChannelType.GuildCategory) throw httpError(400, 'Geçerli bir kategori seçin.'); }
  const next = { ...existing, ...patch };
  if (next.ticketEnabled && (!next.ticketChannelId || !next.supportRoleId)) throw httpError(400, 'Bilet sistemi için kanal ve destek rolü seçin.');
  if (next.defenseEnabled && (!next.defenseChannelId || !next.supportRoleId)) throw httpError(400, 'Savunma sistemi için ana kanal ve destek rolü seçin.');
}

export function createDashboard({ client, store, music, features, config, logger = () => {}, fetcher = fetch }) {
  const sessions = new Map(), pendingStates = new Map(), limits = new Map();
  const base = new URL(config.publicUrl);
  const secure = base.protocol === 'https:';
  const configured = Boolean(config.clientSecret && config.sessionSecret);
  const sign = value => createHmac('sha256', config.sessionSecret || '').update(value).digest('base64url');
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const json = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  };
  const redirect = (response, location) => { response.writeHead(303, { Location: location }).end(); };
  const clean = () => {
    const now = Date.now();
    for (const map of [sessions, pendingStates, limits]) for (const [key, value] of map) if (value.expires <= now) map.delete(key);
  };
  const cleanup = setInterval(clean, 60_000);
  cleanup.unref();

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
    const [id, signature] = raw.split('.');
    if (!id || !constantEqual(signature, sign(id))) return undefined;
    const session = sessions.get(id);
    if (!session || session.expires <= Date.now()) { sessions.delete(id); return undefined; }
    return { id, ...session };
  }

  async function authorizedGuild(guildId, session) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw httpError(404, 'Bot bu sunucuda bulunamadı.');
    let member;
    try { member = await guild.members.fetch({ user: session.user.id, force: true }); }
    catch { throw httpError(403, 'Bu sunucuyu yönetme yetkiniz yok.'); }
    if (!member.permissions.has(manageGuild)) throw httpError(403, 'Sunucuyu Yönet izni gerekli.');
    return { guild, member };
  }

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url, base);
      if (staticFiles.has(url.pathname) && request.method === 'GET') {
        const [file, type] = staticFiles.get(url.pathname);
        const body = await readFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)));
        response.writeHead(200, { 'Content-Type': type });
        response.end(body);
        return;
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        json(response, 200, { name: 'Pit-Stop', ready: client.isReady(), loginConfigured: configured });
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

      if (url.pathname === '/auth/login' && request.method === 'GET') {
        if (!configured) throw httpError(503, 'Panel girişi için Discord OAuth2 bilgileri henüz ayarlanmadı.');
        clean();
        if (pendingStates.size >= 1000) throw httpError(429, 'Lütfen daha sonra tekrar deneyin.');
        const state = random();
        pendingStates.set(state, { expires: Date.now() + 300_000 });
        response.setHeader('Set-Cookie', cookie('pitstop_state', state, 300));
        const target = new URL('https://discord.com/oauth2/authorize');
        target.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', scope: 'identify guilds', redirect_uri: `${base.origin}/auth/callback`, state });
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
        if (url.searchParams.has('error') || !url.searchParams.get('code')) { redirect(response, '/?login=cancelled'); return; }
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
        const id = random();
        const seconds = Math.max(1, Math.min(8 * 3600, Number(token.expires_in) || 3600));
        sessions.set(id, { user: { id: user.id, username: user.username, name: user.global_name || user.username, avatar: user.avatar }, accessToken: token.access_token, csrf: random(), expires: Date.now() + seconds * 1000 });
        response.setHeader('Set-Cookie', [cookie('pitstop_state', '', 0), cookie('pitstop_session', `${id}.${sign(id)}`, seconds)]);
        redirect(response, '/');
        return;
      }
      if (!session) throw httpError(401, 'Discord hesabınızla giriş yapın.');
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.origin !== base.origin || !constantEqual(request.headers['x-csrf-token'], session.csrf)) throw httpError(403, 'İstek doğrulanamadı. Sayfayı yenileyin.');
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        sessions.delete(session.id);
        response.setHeader('Set-Cookie', cookie('pitstop_session', '', 0));
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        json(response, 200, { user: session.user, csrf: session.csrf, installationOwner: config.ownerIds?.includes(session.user.id) || false });
        return;
      }
      if (url.pathname === '/api/guilds' && request.method === 'GET') {
        const guilds = await discordApi('/users/@me/guilds', session.accessToken);
        json(response, 200, guilds.filter(guild => client.guilds.cache.has(guild.id) && (guild.owner || (BigInt(guild.permissions) & (manageGuild | PermissionFlagsBits.Administrator)) !== 0n)).map(guild => ({ id: guild.id, name: guild.name, icon: guild.icon })));
        return;
      }
      const match = /^\/api\/guilds\/(\d{17,20})(?:\/(settings|logs|music|blacklist|reminders|tickets|cases|protection|access))?$/.exec(url.pathname);
      if (!match) throw httpError(404, 'Sayfa bulunamadı.');
      const [, guildId, resource] = match;
      const { guild, member } = await authorizedGuild(guildId, session);
      if (!resource && request.method === 'GET') {
        await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
        const me = guild.members.me;
        const botPermissions = me?.permissions;
        if (!session.seenGuilds?.has(guildId)) {
          const live = sessions.get(session.id); live.seenGuilds ??= new Set(); live.seenGuilds.add(guildId);
          store.addLog(guildId, { type: 'panel.login', actorId: session.user.id, message: `${session.user.name} yönetim paneline giriş yaptı.`, details: { actorName: session.user.name } });
        }
        json(response, 200, {
          id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount,
          channels: [...guild.channels.cache.values()].filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildCategory].includes(channel.type) && channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).map(channel => ({ id: channel.id, name: channel.name, type: channel.type })),
          roles: [...guild.roles.cache.values()].filter(role => role.id !== guild.id).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name, color: role.hexColor, assignable: role.editable && !role.managed && member.permissions.has(PermissionFlagsBits.ManageRoles) && (member.id === guild.ownerId || member.roles.highest.comparePositionTo(role) > 0) })),
          settings: store.getSettings(guildId), music: music.getStatus(guildId),
          protection: features?.protectionStatus(), presenceEnabled: config.presenceEnabled || false,
          bot: { ready: client.isReady(), ping: Math.max(0, Math.round(client.ws.ping)), uptime: Math.round(process.uptime()), permissions: Object.fromEntries(Object.entries({ manageRoles: PermissionFlagsBits.ManageRoles, manageMessages: PermissionFlagsBits.ManageMessages, connect: PermissionFlagsBits.Connect, speak: PermissionFlagsBits.Speak, moderateMembers: PermissionFlagsBits.ModerateMembers, viewAuditLog: PermissionFlagsBits.ViewAuditLog, manageChannels: PermissionFlagsBits.ManageChannels, createPrivateThreads: PermissionFlagsBits.CreatePrivateThreads, manageThreads: PermissionFlagsBits.ManageThreads }).map(([key, flag]) => [key, botPermissions?.has(flag) || false])) },
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
        store.addLog(guildId, { type: 'blacklist.updated', actorId: session.user.id, message: `${session.user.name} blacklist kaydını ${request.method === 'POST' ? 'ekledi' : 'kaldırdı'}.`, details: { actorName: session.user.name, userId: body.userId, reason: body.reason } });
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
          if (kind === 'reminder' && item.userId !== session.user.id) throw httpError(403, 'Yalnızca kendi hatırlatıcınızı iptal edebilirsiniz.');
          if (kind === 'reminder') store.deleteRecord(guildId, kind, body.id);
          else {
            const channel = await guild.channels.fetch(item.id).catch(() => null);
            if (kind === 'case' && channel) { await channel.setLocked(true, 'Panelden kapatıldı'); await channel.setArchived(true, 'Panelden kapatıldı'); }
            if (kind === 'ticket' && channel) await channel.permissionOverwrites.edit(item.userId, { SendMessages: false });
            store.putRecord(guildId, kind, item.id, { ...item, status: 'closed', closedAt: Date.now(), closedBy: session.user.id });
          }
          store.addLog(guildId, { type: `${kind}.closed`, actorId: session.user.id, message: `${session.user.name} kaydı kapattı.`, details: { id: body.id } });
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
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); pendingStates.clear(); });
  return server;
}
