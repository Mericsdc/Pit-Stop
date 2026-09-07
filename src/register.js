import { Routes } from 'discord.js';

// Upsert by name. Other application commands are never bulk-deleted.
export async function registerCommands(rest, config, commands) {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  for (const command of commands) {
    const payload = command.data.toJSON();
    if (config.guildId) {
      delete payload.contexts;
      delete payload.integration_types;
    }
    await rest.post(route, { body: payload });
  }
  return commands.length;
}
