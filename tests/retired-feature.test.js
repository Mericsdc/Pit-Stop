import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { purgeRetiredData, retireDiscordCommands } from '../deploy/remove-rpg.mjs';

test('SQLite backup keeps a valid complete snapshot before game data is removed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pit-stop-backup-'));
  t.after(() => rm(directory, { recursive: true }));
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE feature_records (kind TEXT); CREATE TABLE audit_logs (type TEXT); CREATE TABLE guild_settings (settings_json TEXT);
    INSERT INTO feature_records VALUES ('rpg_player'), ('panel_session');`);
  const path = join(directory, 'backup.sqlite');
  await backup(database, path);
  purgeRetiredData(database);
  const snapshot = new DatabaseSync(path, { readOnly: true });
  assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(snapshot.prepare('SELECT count(*) AS count FROM feature_records').get().count, 2);
  assert.equal(database.prepare('SELECT count(*) AS count FROM feature_records').get().count, 1);
  snapshot.close(); database.close();
});

test('retired game cleanup preserves unrelated settings, records and audit history', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE feature_records (kind TEXT, data_json TEXT);
    CREATE TABLE audit_logs (type TEXT);
    CREATE TABLE guild_settings (settings_json TEXT);
    INSERT INTO feature_records VALUES ('rpg_player','{}'), ('rpg_auction','{}'), ('panel_session','{}'), ('crew_daily','{}'), ('rpgXkeep','{}');
    INSERT INTO audit_logs VALUES ('rpg.transfer'), ('panel.login'), ('rpgXkeep');
    INSERT INTO guild_settings VALUES ('{"rpgAnnouncementChannelId":"123","panelSessionHours":4,"panelAccessRoleIds":["456"]}');`);
  assert.deepEqual(purgeRetiredData(db), { records: 2, logs: 1, settings: 1 });
  assert.deepEqual(db.prepare('SELECT kind FROM feature_records').all().map(row => row.kind), ['panel_session', 'crew_daily', 'rpgXkeep']);
  assert.deepEqual(db.prepare('SELECT type FROM audit_logs').all().map(row => row.type), ['panel.login', 'rpgXkeep']);
  assert.deepEqual(JSON.parse(db.prepare('SELECT settings_json FROM guild_settings').get().settings_json), { panelSessionHours: 4, panelAccessRoleIds: ['456'] });
  assert.deepEqual(purgeRetiredData(db), { records: 0, logs: 0, settings: 0 });
  db.close();
});

test('retired Discord command cleanup covers global and configured guild scopes while preserving current commands', async () => {
  const routes = new Map();
  const deleted = [];
  const rest = {
    get: async route => {
      if (!routes.has(route)) routes.set(route, [{ name: 'çalış', id: 'old' }, { name: 'map', id: 'current' }, { name: 'unrelated', id: 'other' }]);
      return routes.get(route);
    },
    delete: async route => {
      deleted.push(route);
      const scope = route.slice(0, route.lastIndexOf('/'));
      routes.set(scope, routes.get(scope).filter(command => command.id !== 'old'));
    },
  };
  assert.equal(await retireDiscordCommands(rest, { clientId: '123', guildId: '456', allowedGuildIds: ['456', '789'] }), 3);
  assert.equal(routes.size, 3);
  for (const values of routes.values()) assert.deepEqual(values.map(command => command.name), ['map', 'unrelated']);
  assert.equal(deleted.length, 3);
});

test('published panel and bot entry points no longer load the retired game', () => {
  for (const file of ['../public/app.js', '../public/index.html', '../public/styles.css', '../public/layout.css', '../src/index.js', '../src/dashboard.js', '../src/store.js']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /rpg|Mini RPG|PitCoin/iu);
  }
});
