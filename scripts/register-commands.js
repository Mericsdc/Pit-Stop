import { REST } from 'discord.js';
import { commands } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { registerCommands } from '../src/register.js';
import { log, safeError } from '../src/logger.js';
import { createMusic } from '../src/music.js';
import { createFeatures } from '../src/features.js';

try {
  const config = readConfig();
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2 }).setToken(config.token);
  const music = createMusic({}, { getSettings: () => ({}) });
  const count = await registerCommands(rest, config, [...commands, ...music.commands, ...createFeatures({}, {}).commands]);
  console.log(`${count} Pit-Stop komutu ${config.guildId ? 'sunucuya' : 'global olarak'} kaydedildi.`);
} catch (error) {
  log('error', 'registration_failed', safeError(error));
  process.exitCode = 1;
}
