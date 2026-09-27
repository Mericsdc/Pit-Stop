const API_URL = 'https://api.nightriderz.world/gateway.php?contentType=application/json';
const CATALOG_TTL = 30 * 60_000;
const RESULTS_TTL = 5 * 60_000;
const SETUP_TTL = 60 * 60_000;

export const leaderboardUrl = id => `https://nightriderz.world/leaderboard/${id}/1/${Number(id) >= 5000 ? 'nopu' : 'pu'}`;
export const setupUrl = hash => `https://nightriderz.world/car/${encodeURIComponent(hash)}`;
export const formatRaceTime = milliseconds => {
  const ms = Math.max(0, Math.trunc(Number(milliseconds) || 0));
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US')
    .replace(/\[\s*(?:ta|time.attack)\s*\]/giu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function raceName(value) {
  return String(value || '').replace(/\s*\[\s*(?:ta|time.attack)\s*\]\s*$/iu, '').trim();
}

function compactSetup(data) {
  if (!data || typeof data !== 'object') return null;
  const descriptions = key => (Array.isArray(data[key]) ? data[key] : [])
    .map(part => String(part?.longDescription || part?.productTitle || '').trim())
    .filter(Boolean).slice(0, 8);
  return {
    rating: Number(data.carRating) || null,
    performance: descriptions('PERFORMANCEPART'),
    skills: descriptions('SKILLMODPART'),
    visual: descriptions('VISUALPART'),
  };
}

export function createNrzLeaderboards({ fetcher = fetch, now = Date.now } = {}) {
  let catalogCache;
  let catalogPending;
  const resultCache = new Map();
  const setupCache = new Map();

  async function request(serviceName, methodName, parameters) {
    const response = await fetcher(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ serviceName, methodName, parameters }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`NRZ API ${response.status} yanıtını verdi.`);
    return response.json();
  }

  async function catalog() {
    if (catalogCache?.expires > now()) return catalogCache.value;
    if (catalogPending) return catalogPending;
    catalogPending = (async () => {
      const cards = await request('leaderboard', 'GetCards', []);
      if (!Array.isArray(cards)) throw new Error('NRZ yarış kataloğu okunamadı.');
      const races = cards.map(card => card?.race ?? card).filter(Boolean);
      const byId = new Map(races.map(race => [Number(race.id ?? race.ID), race]));
      const value = races.filter(race => {
        const id = Number(race.id ?? race.ID);
        return id > 0 && id < 5000 && !(id >= 2000 && id <= 3000)
          && Number(race.rankedMode) !== 1 && race.name;
      }).map(race => {
        const id = Number(race.id ?? race.ID);
        const attack = byId.get(id + 5000);
        return {
          id, name: raceName(race.name), eventModeId: Number(race.eventModeId),
          classHash: String(race.carClassHash || ''), active: Number(race.isEnabled) === 1,
          timeAttackId: attack ? id + 5000 : null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      catalogCache = { value, expires: now() + CATALOG_TTL };
      return value;
    })();
    try { return await catalogPending; } finally { catalogPending = null; }
  }

  async function findMap(query) {
    const maps = await catalog();
    const needle = normalized(query);
    if (!needle || needle.length > 100) return { map: null, suggestions: [] };
    const exact = maps.find(map => normalized(map.name) === needle || String(map.id) === needle);
    if (exact) return { map: exact, suggestions: [] };
    const matches = maps.filter(map => normalized(map.name).includes(needle)).slice(0, 8);
    return matches.length === 1 ? { map: matches[0], suggestions: [] } : { map: null, suggestions: matches };
  }

  async function rows(id, noPowerups) {
    const key = `${id}:${Number(noPowerups)}`;
    const cached = resultCache.get(key);
    if (cached?.expires > now()) return cached.value;
    if (cached?.pending) return cached.pending;
    const pending = (async () => {
      const response = await request('leaderboard', 'GetData', [String(id), 1, noPowerups ? 1 : 0, '', '', 'asc']);
      const hits = response?.event?.hits;
      if (!Array.isArray(hits)) throw new Error('NRZ sıralama verisi okunamadı.');
      const value = hits.map(hit => {
        const car = hit?.car || {};
        const race = hit?.race || {};
        const ms = Number(race.eventDurationInMilliseconds);
        if (!Number.isFinite(ms) || ms <= 0) return null;
        return {
          driver: String(hit.persona?.[0]?.name || 'Bilinmeyen sürücü'),
          car: [car.manufactor, car.model].filter(Boolean).join(' ').trim() || 'Bilinmeyen araç',
          milliseconds: ms, rating: Number(car.rating) || null,
          setupHash: /^[a-f0-9]{40}$/iu.test(String(car.eventDataSetupHash || '')) ? car.eventDataSetupHash : null,
          date: race.date || null,
        };
      }).filter(Boolean).sort((a, b) => a.milliseconds - b.milliseconds).slice(0, 10);
      resultCache.set(key, { value, expires: now() + RESULTS_TTL });
      return value;
    })();
    resultCache.set(key, { pending });
    try { return await pending; } catch (error) { resultCache.delete(key); throw error; }
  }

  async function setup(hash) {
    if (!hash) return null;
    const cached = setupCache.get(hash);
    if (cached?.expires > now()) return cached.value;
    if (cached?.pending) return cached.pending;
    const pending = request('players', 'getCarsInfoHash', [hash]).then(compactSetup);
    setupCache.set(hash, { pending });
    try {
      const value = await pending;
      setupCache.set(hash, { value, expires: now() + SETUP_TTL });
      return value;
    } catch (error) { setupCache.delete(hash); throw error; }
  }

  async function withTuning(entries) {
    const output = entries.map(entry => ({ ...entry, tuning: null }));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, output.length) }, async () => {
      while (next < output.length) {
        const index = next++;
        if (output[index].setupHash) output[index].tuning = await setup(output[index].setupHash).catch(() => null);
      }
    }));
    return output;
  }

  async function getMap(query) {
    const found = await findMap(query);
    if (!found.map) return found;
    const map = found.map;
    const [normal, timeAttack] = await Promise.all([
      rows(map.id, map.eventModeId === 19),
      map.timeAttackId ? rows(map.timeAttackId, true) : Promise.resolve([]),
    ]);
    const enriched = await withTuning([...normal, ...timeAttack]);
    return { map, normal: enriched.slice(0, normal.length), timeAttack: enriched.slice(normal.length), suggestions: [] };
  }

  return { catalog, findMap, getMap };
}
