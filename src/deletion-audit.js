import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { userLabel } from './audit.js';
const commandDeletions = new WeakMap();
export function rememberCommandDeletion(client, ids, user) {
  if (!client) return () => {};
  let records = commandDeletions.get(client);
  if (!records) { records = new Map(); commandDeletions.set(client, records); }
  const expiry = Date.now() + 15000;
  for (const [id, record] of records) if (record.expiry < Date.now()) records.delete(id);
  for (const id of ids) records.set(id, { actorId: user.id, actorName: userLabel(user), attribution: 'Pit-Stop /clear veya /temizle komutunu kullanan yetkili', expiry });
  while (records.size > 10000) records.delete(records.keys().next().value);
  return () => { for (const id of ids) records.delete(id); };
}
export function commandDeletionActor(client, ids) {
  const records = commandDeletions.get(client), matches = ids.map(id => records?.get(id));
  if (!matches.length || matches.some(record => !record || record.expiry < Date.now()) || new Set(matches.map(record => record.actorId)).size !== 1) return null;
  for (const id of ids) records.delete(id);
  const { expiry: _expiry, ...actor } = matches[0];
  return actor;
}

/** Gateway deletions contain the message author, never the deleting moderator. */
export function createDeletionAudit({ now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), settleMs = 1800 } = {}) {
  const consumed = new Map(), inFlight = new Map();
  async function entries(guild, type) {
    const key = `${guild.id}:${type}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const request = guild.fetchAuditLogs({ type, limit: 20 });
    inFlight.set(key, request);
    try { return await request; } finally { inFlight.delete(key); }
  }
  function remember(entry, count) {
    if (consumed.size >= 5000) consumed.delete(consumed.keys().next().value);
    consumed.set(entry.id, count);
  }
  return {
    async prime(guild) {
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog) || !guild.fetchAuditLogs) return;
      for (const type of [AuditLogEvent.MessageDelete, AuditLogEvent.MessageBulkDelete]) {
        try { const logs = await entries(guild, type); for (const entry of logs.entries.values()) remember(entry, Number(entry.extra?.count || 1)); } catch { /* A missing permission is reported on actual deletion logs. */ }
      }
    },
    async resolve(guild, { channelId, authorId, count = 1, bulk = false, observedAt = now() }) {
      const unknown = reason => ({ actorId: null, actorName: null, attribution: reason });
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog) || !guild.fetchAuditLogs) return unknown('Denetim Kaydını Görüntüle izni yok.');
      if (!bulk && !authorId) return unknown('Mesaj yazarı önbellekte yok; denetim kaydı güvenle eşleştirilemedi.');
      await delay(settleMs);
      try {
        const logs = await entries(guild, bulk ? AuditLogEvent.MessageBulkDelete : AuditLogEvent.MessageDelete);
        const candidates = [...logs.entries.values()].filter(entry => {
          const targetChannel = entry.extra?.channel?.id || entry.extra?.channelId || entry.targetId;
          if (targetChannel !== channelId || (!bulk && entry.targetId !== authorId) || !entry.executorId) return false;
          const total = Number(entry.extra?.count || 1), previous = consumed.get(entry.id);
          if (previous !== undefined) return total - previous >= count;
          return entry.createdTimestamp >= observedAt - 1500 && entry.createdTimestamp <= now() + 1000 && total >= count;
        });
        if (new Set(candidates.map(entry => entry.executorId)).size > 1) return unknown('Birden fazla yetkilinin kaydı eşleşti; silen kişi kesinleştirilemedi.');
        const entry = candidates[0];
        if (!entry) return unknown('Discord eşleşen yetkili kaydı vermedi. Kişinin kendi sildiği mesajlar denetim kaydına yazılmaz.');
        remember(entry, (consumed.get(entry.id) || 0) + count);
        return { actorId: entry.executorId, actorName: userLabel(entry.executor), auditId: entry.id, attribution: 'Discord denetim kaydı; kanal, yazar, zaman ve adet eşleşmesi', reason: entry.reason || null };
      } catch { return unknown('Discord denetim kaydı alınamadı; silen kişi belirlenemedi.'); }
    },
  };
}
