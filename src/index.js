import { ActivityType, Client, Events, GatewayIntentBits, Partials, REST } from 'discord.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config.js';
import { commands } from './commands.js';
import { createHealthServer } from './health.js';
import { log, safeError } from './logger.js';
import { registerCommands } from './register.js';
import { createInteractionHandler } from './router.js';
import { createStore } from './store.js';
import { installCommunityHandlers } from './community.js';
import { createMusic } from './music.js';
import { createDashboard } from './dashboard.js';
import { createFeatures } from './features.js';
import { installAuditIdentity } from './audit.js';
import { createCrewTracker } from './crew.js';

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration, ...(config.presenceEnabled ? [GatewayIntentBits.GuildPresences] : [])],
  partials: [Partials.Message, Partials.Channel],
  allowedMentions: { parse: [], repliedUser: false },
  presence: { activities: [{ name: '/yardim • Pit-Stop', type: ActivityType.Playing }], status: 'online' },
});
const health = createHealthServer(() => client.isReady());
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const store = createStore(join(config.dataDir, 'pit-stop.sqlite'));
installAuditIdentity(client, store);
const music = createMusic(client, store, config, { logger: log });
const features = createFeatures(client, store, config, { logger: log });
const crew = createCrewTracker(store, config, { logger: log });
features.install();
const allCommands = [...commands, ...music.commands, ...features.commands];
const removeCommunityHandlers = installCommunityHandlers(client, store, { logger: log });
const dashboard = createDashboard({ client, store, music, features, crew, config, logger: log });
let stopping = false;
let disconnectedAt;

async function shutdown(code, reason) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { reason });
  clearInterval(watchdog);
  const deadline = setTimeout(() => process.exit(code), 5000);
  deadline.unref();
  removeCommunityHandlers();
  features.close();
  crew.close();
  await music.close();
  await client.destroy();
  for (const server of [health, dashboard]) {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  store.close();
  process.exitCode = code;
}

// Let discord.js reconnect; restart the process if it remains unavailable for five minutes.
const watchdog = setInterval(() => {
  if (client.isReady()) {
    disconnectedAt = undefined;
  } else {
    disconnectedAt ??= Date.now();
    if (Date.now() - disconnectedAt >= 300_000) void shutdown(1, 'connection_timeout');
  }
}, 15_000);
watchdog.unref();

client.once(Events.ClientReady, readyClient => {
  log('info', 'ready', { bot: readyClient.user.tag, guilds: readyClient.guilds.cache.size });
  void music.initialize().catch(error => log('error', 'music_initialize_failed', safeError(error)));
  void features.initialize().catch(error => log('error', 'features_initialize_failed', safeError(error)));
  void crew.initialize().catch(error => log('error', 'crew_initialize_failed', safeError(error)));
});
client.on(Events.Raw, payload => music.handleRaw(payload));
client.on(Events.InteractionCreate, createInteractionHandler(allCommands, { logger: log, store }));
client.on(Events.Error, error => log('error', 'discord_error', safeError(error)));
client.on(Events.ShardError, error => log('error', 'gateway_error', safeError(error)));
client.on(Events.ShardDisconnect, (_event, shardId) => log('info', 'gateway_disconnected', { shardId }));
process.once('SIGINT', () => void shutdown(0, 'SIGINT'));
process.once('SIGTERM', () => void shutdown(0, 'SIGTERM'));
process.on('unhandledRejection', error => {
  log('error', 'unhandled_rejection', safeError(error));
  void shutdown(1, 'unhandled_rejection');
});
process.on('uncaughtException', error => {
  log('error', 'uncaught_exception', safeError(error));
  void shutdown(1, 'uncaught_exception');
});

try {
  await new Promise((resolve, reject) => {
    health.once('error', reject);
    health.listen(config.healthPort, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => {
    dashboard.once('error', reject);
    dashboard.listen(config.dashboardPort, config.dashboardHost, resolve);
  });
  log('info', 'dashboard_listening', { url: config.publicUrl });
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2 }).setToken(config.token);
  const application = await rest.get('/oauth2/applications/@me');
  if (application.id !== config.clientId) {
    log('error', 'application_id_mismatch');
    await shutdown(1, 'application_id_mismatch');
  } else if (!stopping) {
    await client.login(config.token);
    const count = await registerCommands(rest, config, allCommands);
    log('info', 'commands_registered', { count, scope: config.guildId ? 'guild' : 'global' });
  }
} catch (error) {
  log('error', 'startup_failed', safeError(error));
  await shutdown(1, 'startup_failed');
}
