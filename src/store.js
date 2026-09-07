import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_SETTINGS = Object.freeze({
  leaveEnabled: false,
  leaveChannelId: null,
  leaveMessage: '{user} sunucudan ayrıldı.',
  autoRoleEnabled: false,
  autoRoleId: null,
  responderEnabled: false,
  responses: [],
  musicEnabled: false,
  musicVolume: 50,
  djRoleId: null,
  logChannelId: null,
});
const BOOLEAN_KEYS = new Set(['leaveEnabled', 'autoRoleEnabled', 'responderEnabled', 'musicEnabled']);
const ID_KEYS = new Set(['leaveChannelId', 'autoRoleId', 'djRoleId', 'logChannelId']);
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} bir nesne olmalı.`);
  }
}

function snowflake(value, label = 'Discord kimliği') {
  if (typeof value !== 'string' || !/^[1-9]\d{16,19}$/u.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n) {
    throw new TypeError(`${label} geçerli bir Discord kimliği olmalı.`);
  }
  return value;
}

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new TypeError(`${label} 1–${max} karakter arasında olmalı.`);
  }
  return value.trim();
}

function logType(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/u.test(value)) {
    throw new TypeError('Günlük türü 1–64 küçük harf, rakam, nokta, tire veya alt çizgiden oluşmalı.');
  }
  return value;
}

function validatePatch(patch) {
  object(patch, 'Ayarlar');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new TypeError(`Bilinmeyen ayar: ${key}`);
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') throw new TypeError(`${key} açık veya kapalı olmalı.`);
      result[key] = value;
    } else if (ID_KEYS.has(key)) {
      result[key] = value === null ? null : snowflake(value, key);
    } else if (key === 'leaveMessage') {
      result[key] = text(value, 'Ayrılma mesajı', 1000);
      const placeholders = result[key].match(/\{[^{}]*\}/gu) ?? [];
      if (placeholders.some((part) => !['{user}', '{username}', '{server}', '{memberCount}'].includes(part))) {
        throw new TypeError('Ayrılma mesajı yalnızca {user}, {username}, {server}, {memberCount} değişkenlerini kullanabilir.');
      }
    } else if (key === 'musicVolume') {
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new TypeError('Ses düzeyi 1–100 arasında bir tam sayı olmalı.');
      result[key] = value;
    } else if (key === 'responses') {
      if (!Array.isArray(value) || value.length > 50) throw new TypeError('En fazla 50 otomatik yanıt tanımlayabilirsin.');
      const seen = new Set();
      result.responses = value.map((response) => {
        object(response, 'Otomatik yanıt');
        if (Object.keys(response).some((name) => !['trigger', 'reply'].includes(name))) {
          throw new TypeError('Otomatik yanıt yalnızca trigger ve reply alanlarını içerebilir.');
        }
        const trigger = text(response.trigger, 'Tetikleyici', 33)
          .normalize('NFKC').replace(/^!/u, '').toLocaleLowerCase('tr-TR');
        if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(trigger)) {
          throw new TypeError('Tetikleyici 1–32 harf, rakam, tire veya alt çizgiden oluşmalı.');
        }
        if (seen.has(trigger)) throw new TypeError('Otomatik yanıt tetikleyicileri benzersiz olmalı.');
        seen.add(trigger);
        return { trigger, reply: text(response.reply, 'Otomatik yanıt metni', 1900) };
      });
    }
  }
  return result;
}

export function createStore(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('Veritabanı dosya yolu gerekli.');
  const databasePath = path === ':memory:' ? path : resolve(path);
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_logs_guild_id ON audit_logs(guild_id, id DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS audit_logs_guild_type ON audit_logs(guild_id, type, id DESC);
  `);
  const getSettingsStatement = database.prepare('SELECT settings_json FROM guild_settings WHERE guild_id = ?');
  const saveSettings = database.prepare(`INSERT INTO guild_settings(guild_id, settings_json, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`);
  const insertLog = database.prepare(`INSERT INTO audit_logs(guild_id, type, actor_id, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const removeExpired = database.prepare('DELETE FROM audit_logs WHERE created_at < ?');
  const trimGuild = database.prepare(`DELETE FROM audit_logs WHERE guild_id = ? AND id <
    (SELECT id FROM audit_logs WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET 9999)`);
  removeExpired.run(Date.now() - RETENTION_MS);
  for (const { guild_id: guildId } of database.prepare('SELECT DISTINCT guild_id FROM audit_logs').all()) {
    trimGuild.run(guildId, guildId);
  }

  function cleanup(guildId) {
    removeExpired.run(Date.now() - RETENTION_MS);
    trimGuild.run(guildId, guildId);
  }

  function getSettings(guildId) {
    snowflake(guildId, 'Sunucu kimliği');
    const row = getSettingsStatement.get(guildId);
    return { ...structuredClone(DEFAULT_SETTINGS), ...(row ? validatePatch(JSON.parse(row.settings_json)) : {}) };
  }

  return {
    getSettings,
    updateSettings(guildId, patch) {
      snowflake(guildId, 'Sunucu kimliği');
      const validated = validatePatch(patch);
      database.exec('BEGIN IMMEDIATE');
      try {
        const next = { ...getSettings(guildId), ...validated };
        if (next.leaveEnabled && !next.leaveChannelId) throw new TypeError('Ayrılma mesajlarını açmadan önce bir kanal seç.');
        if (next.autoRoleEnabled && !next.autoRoleId) throw new TypeError('Otomatik rolü açmadan önce bir rol seç.');
        saveSettings.run(guildId, JSON.stringify(next), Date.now());
        database.exec('COMMIT');
        return structuredClone(next);
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    addLog(guildId, entry) {
      snowflake(guildId, 'Sunucu kimliği');
      object(entry, 'Günlük kaydı');
      if (Object.keys(entry).some((key) => !['type', 'actorId', 'message', 'details'].includes(key))) {
        throw new TypeError('Günlük kaydı bilinmeyen alanlar içeriyor.');
      }
      const type = logType(entry.type);
      const actorId = entry.actorId == null ? null : snowflake(entry.actorId, 'İşlemi yapan kişi');
      const message = text(entry.message, 'Günlük mesajı', 500);
      const details = entry.details ?? {};
      object(details, 'Günlük ayrıntıları');
      const detailsJSON = JSON.stringify(details);
      if (detailsJSON.length > 4000) throw new TypeError('Günlük ayrıntıları en fazla 4000 karakter olabilir.');
      const createdAt = Date.now();
      database.exec('BEGIN IMMEDIATE');
      try {
        const inserted = insertLog.run(guildId, type, actorId, message, detailsJSON, createdAt);
        cleanup(guildId);
        database.exec('COMMIT');
        return { id: Number(inserted.lastInsertRowid), guildId, type, actorId, message, details: JSON.parse(detailsJSON), createdAt };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    getLogs(guildId, options = {}) {
      snowflake(guildId, 'Sunucu kimliği');
      object(options, 'Günlük filtresi');
      if (Object.keys(options).some((key) => !['limit', 'before', 'type'].includes(key))) {
        throw new TypeError('Bilinmeyen günlük filtresi.');
      }
      const limit = options.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Günlük sınırı 1–100 arasında olmalı.');
      const parameters = [guildId];
      let query = 'SELECT * FROM audit_logs WHERE guild_id = ?';
      if (options.before != null) {
        const before = typeof options.before === 'string' && /^\d+$/u.test(options.before) ? Number(options.before) : options.before;
        if (!Number.isSafeInteger(before) || before < 1) throw new TypeError('Günlük sayfalama kimliği geçersiz.');
        query += ' AND id < ?';
        parameters.push(before);
      }
      if (options.type != null && options.type !== '') {
        query += ' AND type = ?';
        parameters.push(logType(options.type));
      }
      cleanup(guildId);
      parameters.push(limit);
      return database.prepare(`${query} ORDER BY id DESC LIMIT ?`).all(...parameters).map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        type: row.type,
        actorId: row.actor_id,
        message: row.message,
        details: JSON.parse(row.details_json),
        createdAt: row.created_at,
      }));
    },
    close() { database.close(); },
  };
}
