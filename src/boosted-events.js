const API_URL = 'https://api.nightriderz.world/gateway.php?contentType=application/json';
export const LIVE_MAP_URL = 'https://nightriderz.world/livemap';
export const eventUrl = id => `https://nightriderz.world/leaderboard/${id}`;
const HALF_HOUR = 30 * 60_000;
export const SITE_UPDATE_DELAY = 90_000;
const STALE_RETRY_DELAY = 20_000;
const MAX_STALE_RETRIES = 15;
const TYPE_NAMES = Object.freeze({ '4': 'Circuit', '9': 'Sprint', '19': 'Drag', '22': 'Meeting Place', '24': 'Team Escape', '12': 'Pursuit Outrun' });

const clean = value => String(value || '').replace(/<[^>]*>/gu, '').replace(/&middot;|&#183;/giu, '·').replace(/&amp;/giu, '&').trim();

export function nextHalfHourDelay(timestamp = Date.now()) {
  const remainder = timestamp % HALF_HOUR;
  return remainder === 0 ? HALF_HOUR : HALF_HOUR - remainder;
}

export function nextBoostedRefreshDelay(timestamp = Date.now(), updateDelay = SITE_UPDATE_DELAY) {
  const boundary = Math.floor(timestamp / HALF_HOUR) * HALF_HOUR;
  const currentWindowRefresh = boundary + updateDelay;
  return timestamp < currentWindowRefresh ? currentWindowRefresh - timestamp : boundary + HALF_HOUR + updateDelay - timestamp;
}

function findClassEmoji(className, guild) {
  const match = String(className || '').match(/\bClass\s+([A-Z](?:[12])?)/iu);
  const token = match?.[1]?.toUpperCase();
  if (!token) return null;
  const candidates = [`${token}class`.toLowerCase(), ...(token === 'S' ? ['s1class'] : [])];
  return [...(guild?.emojis?.cache?.values?.() || [])].find(item => candidates.includes(String(item.name || '').toLowerCase())) || null;
}

export function classEmoji(className, guild) {
  const emoji = findClassEmoji(className, guild);
  return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '';
}

export function normalizeBoostedEvent(races) {
  const race = Array.isArray(races) ? races.find(item => item?.isBoosted === 1 || item?.isBoosted === '1') : null;
  if (!race) return null;
  const id = String(race.id || '');
  const name = clean(race.name).replace(/\s*\([^)]*\)\s*$/u, '').slice(0, 120);
  if (!/^\d{1,12}$/u.test(id) || !name) return null;
  return { id, name, type: TYPE_NAMES[String(race.eventModeId)] || 'Yarış', eventModeId: String(race.eventModeId || '') };
}

export function parseLeaderboardDescription(html, fallbackType = 'Yarış') {
  const match = String(html || '').match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/iu)
    || String(html || '').match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/iu);
  const description = clean(match?.[1]);
  const classMatch = description.match(/\bClass\s+([A-Za-z0-9+-]+)/iu);
  return { className: classMatch ? `Class ${classMatch[1].toUpperCase()}` : 'Sınıf belirtilmedi', description: description || fallbackType };
}

export function createBoostedEventMonitor(client, store, config = {}, { fetcher = fetch, now = Date.now, logger = () => {} } = {}) {
  const homeGuildId = config.allowedGuildIds?.[0] || config.guildId;
  let timeout;
  let running;

  async function requestRaces() {
    const response = await fetcher(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://livemap.nightriderz.world', Referer: 'https://livemap.nightriderz.world/' },
      body: JSON.stringify({ serviceName: 'livemap', methodName: 'getRaces' }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`NightRiderz canlı harita servisi ${response.status} yanıtını verdi.`);
    return normalizeBoostedEvent(await response.json());
  }

  async function enrich(event) {
    if (!event) return null;
    try {
      const response = await fetcher(`https://nightriderz.world/leaderboard/${event.id}`, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) return { ...event, className: 'Sınıf belirtilmedi', description: event.type };
      return { ...event, ...parseLeaderboardDescription(await response.text(), event.type) };
    } catch { return { ...event, className: 'Sınıf belirtilmedi', description: event.type }; }
  }

  function getStatus(guildId = homeGuildId) {
    return store.getRecord(guildId, 'boosted_event', 'current') || { event: null, checkedAt: null, announcedAt: null, error: null };
  }

  async function refresh(guildId = homeGuildId, forceAnnouncement = false) {
    if (!guildId) return getStatus(guildId);
    if (running) return running;
    running = (async () => {
      const previous = getStatus(guildId);
      try {
        let event = await enrich(await requestRaces());
        const checkedAt = now();
        const guild = client.guilds.cache.get(guildId);
        if (event) {
          const emoji = findClassEmoji(event.className, guild);
          event = { ...event, url: eventUrl(event.id), classEmoji: emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '', classEmojiId: emoji?.id || null, endsAt: checkedAt + nextHalfHourDelay(checkedAt) };
        }
        const settings = store.getSettings(guildId);
        const channelId = settings.boostedEventChannelId || config.boostedEventChannelId;
        const changed = Boolean(event && (!previous.event || previous.event.id !== event.id || previous.event.className !== event.className));
        let announcedAt = previous.announcedAt || null;
        if (event && settings.boostedEventEnabled && channelId && (changed || forceAnnouncement)) {
          const channel = await guild?.channels.fetch(channelId).catch(() => null);
          if (!channel?.isTextBased?.()) throw new Error('Boosted Event bildirim kanalı bulunamadı veya yazılabilir değil.');
          const sent = await channel.send({
            content: `⚡ **BOOSTED EVENT**\n**Etkinlik:** ${event.name}\n${event.url}\n**Sınıf:** ${event.className}\n**Tür:** ${event.type}\n**Bitiş:** <t:${Math.floor(event.endsAt / 1000)}:t> (<t:${Math.floor(event.endsAt / 1000)}:R>)`,
            allowedMentions: { parse: [] },
          });
          let reactionAdded = false;
          if (event.classEmojiId && sent?.react) reactionAdded = await sent.react(event.classEmojiId).then(() => true).catch(error => { logger('warn', 'boosted_event_reaction_failed', { message: error.message, emojiId: event.classEmojiId }); return false; });
          announcedAt = checkedAt;
          store.addLog(guildId, { type: 'boosted.announced', actorId: null, message: `${event.name} boosted etkinliği Discord kanalına gönderildi.`, details: { eventId: event.id, eventName: event.name, eventUrl: event.url, className: event.className, classEmoji: event.classEmoji, classReactionAdded: reactionAdded, eventType: event.type, endsAt: event.endsAt, channelId, checkedAt } });
        }
        const status = { event, checkedAt, announcedAt, channelId: channelId || null, error: null };
        store.putRecord(guildId, 'boosted_event', 'current', status);
        return status;
      } catch (error) {
        const status = { ...previous, checkedAt: now(), error: error.message };
        store.putRecord(guildId, 'boosted_event', 'current', status);
        logger('error', 'boosted_event_refresh_failed', { message: error.message });
        return status;
      }
    })().finally(() => { running = null; });
    return running;
  }

  function schedule() {
    clearTimeout(timeout);
    const previousEvent = getStatus(homeGuildId).event;
    const previousEventKey = previousEvent ? `${previousEvent.id}:${previousEvent.className || ''}:${previousEvent.name || ''}` : null;
    const checkAfterSiteUpdate = async attempt => {
      const status = await refresh();
      const eventKey = status.event ? `${status.event.id}:${status.event.className || ''}:${status.event.name || ''}` : null;
      const stillStale = Boolean(previousEventKey && eventKey === previousEventKey);
      if (stillStale && attempt < MAX_STALE_RETRIES) {
        timeout = setTimeout(() => void checkAfterSiteUpdate(attempt + 1), STALE_RETRY_DELAY);
        timeout.unref?.();
        return;
      }
      schedule();
    };
    timeout = setTimeout(() => void checkAfterSiteUpdate(0), nextBoostedRefreshDelay(now()));
    timeout.unref?.();
  }

  async function initialize() { if (homeGuildId) await refresh(homeGuildId); schedule(); }
  return { initialize, refresh, getStatus, close() { clearTimeout(timeout); } };
}
