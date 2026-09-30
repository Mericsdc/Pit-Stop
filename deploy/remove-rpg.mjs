import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, chown, copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { readConfig } from '../src/config.js';

export const retiredCommands = new Set(['rpg-rehber', 'çalış', 'vardiya', 'maden', 'günlük', 'mağaza', 'market', 'satın-al', 'savaş', 'sınıf', 'öfke', 'ateş-topu', 'nişan', 'iksir', 'görev', 'üret', 'karaborsa', 'garaj', 'garaj-market', 'kargo-hızlandır', 'ekipman-bakım', 'araçlarım', 'parça-al', 'mod-kutusu', 'hurdalık', 'müşteri-tamir', 'araba-al', 'araba-tamir', 'araba-parçala', 'modifiye', 'araba-sat', 'açık-artırma', 'teklif-ver', 'işe-al', 'ikramiye-ver', 'izin-ver', 'mesai-topla', 'otomatik-mesai', 'tamir-et', 'yol-yardım', 'dünya', 'zindan', 'gönder', 'düello', 'zar-at', 'bahis', 'profil', 'sıralama']);

export function purgeRetiredData(database) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const records = database.prepare("DELETE FROM feature_records WHERE kind GLOB 'rpg_*'").run().changes;
    const logs = database.prepare("DELETE FROM audit_logs WHERE type GLOB 'rpg.*'").run().changes;
    const settings = database.prepare("UPDATE guild_settings SET settings_json=json_remove(settings_json, '$.rpgAnnouncementChannelId') WHERE json_type(settings_json, '$.rpgAnnouncementChannelId') IS NOT NULL").run().changes;
    database.exec('COMMIT');
    return { records, logs, settings };
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export async function retireDiscordCommands(rest, config) {
  const scopes = [Routes.applicationCommands(config.clientId), ...[...new Set([config.guildId, ...(config.allowedGuildIds || [])].filter(Boolean))].map(id => Routes.applicationGuildCommands(config.clientId, id))];
  let deleted = 0;
  for (const route of scopes) {
    for (const command of await rest.get(route)) {
      if (retiredCommands.has(command.name)) { await rest.delete(`${route}/${command.id}`); deleted++; }
    }
    if ((await rest.get(route)).some(command => retiredCommands.has(command.name))) throw new Error('Eski oyun komutları tamamen kaldırılamadı.');
  }
  return deleted;
}

async function main() {
  const [operation, backupDir] = process.argv.slice(2);
  if (!['remove', 'restore'].includes(operation) || !backupDir?.startsWith('/opt/pit-stop-optimize-backup.')) throw new Error('Geçersiz yedek konumu veya işlem.');
  const config = readConfig();
  const databasePath = join(config.dataDir, 'pit-stop.sqlite');
  const snapshot = join(backupDir, 'database.sqlite');
  const manifest = join(backupDir, 'database.json');
  if (operation === 'restore') {
    const info = JSON.parse(await readFile(manifest, 'utf8'));
    if (info.path !== databasePath) throw new Error('Veritabanı yedek konumu eşleşmedi.');
    for (const suffix of ['-wal', '-shm']) await rm(databasePath + suffix, { force: true });
    await copyFile(snapshot, databasePath);
    await chown(databasePath, info.uid, info.gid);
    await chmod(databasePath, info.mode);
    return;
  }
  const info = await stat(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Veritabanı doğrulaması başarısız.');
    await backup(database, snapshot);
    await chmod(snapshot, 0o600);
    await writeFile(manifest, JSON.stringify({ path: databasePath, uid: info.uid, gid: info.gid, mode: info.mode & 0o777 }), { mode: 0o600 });
    const removed = purgeRetiredData(database);
    database.exec('VACUUM');
    if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Veritabanı doğrulaması başarısız.');
    console.log('Oyun kayıtları kaldırıldı:', JSON.stringify(removed));
  } finally { database.close(); }
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2 }).setToken(config.token);
  const deleted = await retireDiscordCommands(rest, config);
  console.log(`Discord üzerinden ${deleted} eski oyun komutu kaldırıldı.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Oyun kaldırma işlemi başarısız. Dağıtım önceki sürüme dönecek.'); process.exitCode = 1; });
}
