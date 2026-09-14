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

// Upsert by name. Other application commands are never bulk-deleted.
export async function registerCommands(rest, config, commands) {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  const existing = typeof rest.get === 'function' ? await rest.get(route) : [];
  const byName = new Map(existing.map(item => [item.name, item]));
  for (const legacyName of ['sağlık-asistanı']) {
    const legacy = byName.get(legacyName);
    if (legacy?.id && typeof rest.delete === 'function') await rest.delete(`${route}/${legacy.id}`);
  }
  for (const command of commands) {
    const payload = command.data.toJSON();
    if (config.guildId) {
      delete payload.contexts;
      delete payload.integration_types;
    }
    if (byName.has(payload.name) && comparable(byName.get(payload.name), config.guildId) === comparable(payload, config.guildId)) continue;
    await rest.post(route, { body: payload });
  }
  // Global komutlar Discord önbelleğinde gecikebilir. İzin verilen sunuculara da
  // aynı tanımı yazarak Pit-Stop'un ana sunucusunda güncellemeyi hemen etkinleştir.
  if (!config.guildId) for (const guildId of config.allowedGuildIds || []) {
    await registerCommands(rest, { ...config, guildId }, commands);
  }
  return commands.length;
}
