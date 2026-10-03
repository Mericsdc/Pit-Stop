import assert from 'node:assert/strict';
import { LavalinkManager } from 'lavalink-client';
import { readConfig } from '../src/config.js';
import { normalizeMusicQuery } from '../src/music.js';

// Read-only production check: load metadata without creating a player or joining voice.
const config = readConfig();
const settings = config.lavalink;
if (!settings) throw new Error('Müzik servisi yapılandırılmamış.');
const manager = new LavalinkManager({
  nodes: [{ id: 'check', ...settings, authorization: settings.password }],
  sendToShard() {}, client: { id: config.clientId, username: 'Pit-Stop' },
  playerOptions: { defaultSearchPlatform: 'scsearch' },
});
const node = manager.nodeManager.nodes.get('check');
const response = await fetch(`${node.restAddress}/v4/info`, { headers: { Authorization: settings.password }, signal: AbortSignal.timeout(10000) });
assert.equal(response.status, 200);
node.info = await response.json();
assert.ok(node.info.sourceManagers.includes('soundcloud'));
const query = normalizeMusicQuery('https://soundcloud.com/umitbaran/bana-ninni-okumayin');
const transformed = manager.utils.transformQuery({ query: query.query, source: 'link' });
manager.utils.validateQueryString(node, transformed.query, transformed.source);
manager.utils.validateSourceString(node, transformed.source);
const loadUrl = new URL(`${node.restAddress}/v4/loadtracks`);
loadUrl.searchParams.set('identifier', transformed.query);
const loaded = await fetch(loadUrl, { headers: { Authorization: settings.password }, signal: AbortSignal.timeout(20000) });
assert.equal(loaded.status, 200);
const result = await loaded.json();
assert.equal(result.loadType, 'track');
assert.equal(result.data.info.sourceName, 'soundcloud');
assert.equal(normalizeMusicQuery('Artist Song').source, 'scsearch');
console.log('Panel müzik kaynağı doğrulandı: SoundCloud bağlantısı yüklendi; ses kanalına katılınmadı.');
