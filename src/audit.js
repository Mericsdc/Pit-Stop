export function userLabel(user) {
  return user?.displayName || user?.globalName || user?.name || user?.username || user?.user?.globalName || user?.user?.username || 'Bilinmeyen kullanıcı';
}

export function installAuditIdentity(client, store) {
  const original = store.addLog.bind(store);
  store.addLog = (guildId, entry) => {
    const guild = client.guilds.cache.get(guildId);
    const actor = guild?.members.cache.get(entry.actorId) || client.users.cache.get(entry.actorId);
    return original(guildId, { ...entry, details: { ...entry.details,
      ...(actor ? { actorName: userLabel(actor), actorUsername: actor.user?.username || actor.username } : {}),
    } });
  };
}
