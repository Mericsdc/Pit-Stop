import { Routes } from 'discord.js';

function comparable(command, guild) {
  const fields = ['name', 'description', 'type', 'options', 'default_member_permissions', 'nsfw', ...(guild ? [] : ['contexts', 'integration_types'])];
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] != null && value[key] !== false && !(Array.isArray(value[key]) && !value[key].length)).map(key => [key, clean(value[key])]));
    return value;
  };
  return JSON.stringify(clean(Object.fromEntries(fields.map(key => [key, key === 'type' ? command[key] || 1 : command[key]]))));
}

async function upsertScope(rest, route, commands, guild) {
  const existing = typeof rest.get === 'function' ? await rest.get(route) : [];
  const byName = new Map(existing.map(item => [item.name, item]));
  for (const legacyName of ['sağlık-asistanı']) {
    const legacy = byName.get(legacyName);
    if (legacy?.id && typeof rest.delete === 'function') await rest.delete(`${route}/${legacy.id}`);
  }
  for (const command of commands) {
    const payload = command.data.toJSON();
    if (guild) {
      delete payload.contexts;
      delete payload.integration_types;
    }
    if (byName.has(payload.name) && comparable(byName.get(payload.name), guild) === comparable(payload, guild)) continue;
    await rest.post(route, { body: payload });
  }
}

// Upsert by name. When a deployment is limited to named guilds, commands are
// registered only in those guilds so Discord does not show global duplicates.
// Unrelated application commands are never deleted.
export async function registerCommands(rest, config, commands) {
  if (config.guildId) {
    await upsertScope(rest, Routes.applicationGuildCommands(config.clientId, config.guildId), commands, true);
    return commands.length;
  }
  const guildIds = [...new Set((config.allowedGuildIds || []).filter(Boolean))];
  if (guildIds.length) {
    const globalRoute = Routes.applicationCommands(config.clientId);
    if (typeof rest.get === 'function' && typeof rest.delete === 'function') {
      const ownedNames = new Set(commands.map(item => item.data.toJSON().name));
      const globals = await rest.get(globalRoute);
      for (const existing of globals) {
        if ((ownedNames.has(existing.name) || existing.name === 'sağlık-asistanı') && existing.id) {
          await rest.delete(`${globalRoute}/${existing.id}`);
        }
      }
    }
    for (const guildId of guildIds) {
      await upsertScope(rest, Routes.applicationGuildCommands(config.clientId, guildId), commands, true);
    }
    return commands.length;
  }
  await upsertScope(rest, Routes.applicationCommands(config.clientId), commands, false);
  return commands.length;
}
