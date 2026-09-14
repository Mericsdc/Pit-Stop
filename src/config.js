import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const token = env.DISCORD_TOKEN?.trim();
  if (!token || /^(?:your[_-]|replace|buraya|token_here|<)/i.test(token)) {
    throw new Error('DISCORD_TOKEN eksik. .env dosyasına Discord bot token’ını ekleyin.');
  }
  const clientId = readSnowflake(env.DISCORD_CLIENT_ID, 'DISCORD_CLIENT_ID');
  const guildId = env.DISCORD_GUILD_ID?.trim()
    ? readSnowflake(env.DISCORD_GUILD_ID, 'DISCORD_GUILD_ID') : undefined;
  const healthPort = Number(env.HEALTH_PORT?.trim() || '3000');
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) {
    throw new Error('HEALTH_PORT 1–65535 arasında bir tam sayı olmalı.');
  }
  const dashboardPort = readPort(env.DASHBOARD_PORT, 3001, 'DASHBOARD_PORT');
  if (dashboardPort === healthPort) throw new Error('Panel ve sağlık kontrolü farklı portlarda olmalı.');
  const publicUrl = (env.PUBLIC_URL?.trim() || `http://localhost:${dashboardPort}`).replace(/\/$/, '');
  let url;
  try { url = new URL(publicUrl); } catch { throw new Error('PUBLIC_URL geçerli bir URL olmalı.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_URL yalnızca panelin kök adresi olmalı.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Dışarıdan erişilen panel için PUBLIC_URL HTTPS olmalı.');
  const sessionSecret = env.SESSION_SECRET?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (sessionSecret && sessionSecret.length < 32) throw new Error('SESSION_SECRET en az 32 karakter olmalı.');
  if (clientSecret && !sessionSecret) throw new Error('Panel girişi için SESSION_SECRET gerekli.');
  const lavalinkHost = env.LAVALINK_HOST?.trim();
  const lavalinkPassword = env.LAVALINK_PASSWORD?.trim();
  if (lavalinkHost && !lavalinkPassword) throw new Error('LAVALINK_HOST için LAVALINK_PASSWORD gerekli.');
  return {
    token, clientId, guildId, healthPort, dashboardPort,
    presenceEnabled: env.PRESENCE_ENABLED === 'true',
    allowedGuildIds: (env.ALLOWED_GUILD_IDS || '').split(',').map(id => id.trim()).filter(Boolean).map(id => readSnowflake(id, 'ALLOWED_GUILD_IDS')),
    ownerIds: (env.BOT_OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean).map(id => readSnowflake(id, 'BOT_OWNER_IDS')),
    dashboardHost: env.DASHBOARD_HOST?.trim() || '127.0.0.1',
    publicUrl: url.origin, clientSecret, sessionSecret,
    dataDir: resolve(env.DATA_DIR?.trim() || './data'),
    lavalink: lavalinkHost ? { host: lavalinkHost, port: readPort(env.LAVALINK_PORT, 2333, 'LAVALINK_PORT'), password: lavalinkPassword, secure: env.LAVALINK_SECURE === 'true' } : undefined,
    spotifyConfigured: env.SPOTIFY_ENABLED === 'true' && Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim()),
    boostedEventChannelId: env.BOOSTED_EVENT_CHANNEL_ID?.trim()
      ? readSnowflake(env.BOOSTED_EVENT_CHANNEL_ID, 'BOOSTED_EVENT_CHANNEL_ID') : undefined,
    nightriderz: {
      userKey: env.NRZ_USER_KEY?.trim() || '',
      personaKey: env.NRZ_PERSONA_KEY?.trim() || '',
    },
    weather: {
      city: env.DEFAULT_WEATHER_CITY?.trim() || 'İstanbul',
      latitude: Number(env.DEFAULT_WEATHER_LATITUDE || 41.0082),
      longitude: Number(env.DEFAULT_WEATHER_LONGITUDE || 28.9784),
    },
  };
}

function readPort(value, fallback, name) {
  const port = Number(value?.trim() || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} 1–65535 arasında bir tam sayı olmalı.`);
  return port;
}

export function readSnowflake(value, name) {
  const id = value?.trim();
  if (!id || !/^\d{17,20}$/.test(id) || BigInt(id) === 0n || BigInt(id) > 18446744073709551615n) {
    throw new Error(`${name} geçerli bir Discord kimliği olmalı.`);
  }
  return id;
}
