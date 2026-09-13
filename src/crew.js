const API_URL = 'https://api.nightriderz.world/gateway.php?contentType=application/json';
export const NRZ_CREW_ID = 1636;
export const NRZ_CREW_URL = `https://nightriderz.world/crew/headquarters/${NRZ_CREW_ID}`;

// Initial roster read from the crew's Members section. When a read-only
// NightRiderz session is configured, GetMembersRep replaces this seed.
export const INITIAL_CREW_MEMBERS = [
  ['LUREXA', 5_402_650], ['PISTOLSHOW', 4_825_990], ['KCARMZ', 6_001_280],
  ['3BaaaTuuuUuuu', 3_407_000], ['SIKISTACIRI', 2_424_320], ['OBJEKTIF', 2_422_720],
  ['AlphaTurk', 1_981_950], ['ANLKCDMR', 1_353_660], ['TaskForce141YT', 1_112_080],
  ['JELLYBERYY', 1_111_040], ['XEROEGE', 1_006_480], ['SAYUHRII', 1_002_290],
  ['DRWH1SKEY', 976_560], ['BURAK35', 883_250], ['3NO', 702_820],
  ['EkmekArasiTuz', 630_250], ['BUKOVKSI', 584_340], ['NAC', 578_450],
  ['HYRONV1', 386_220], ['RIPVRO', 354_900], ['KAGEBADI', 343_850],
  ['SWITHRA', 192_900], ['FARUK01', 183_560], ['ASFALTCANAVARI', 165_300],
  ['HYMENEA', 139_950], ['NYTRIX', 95_300], ['SMELLSLIKEBERK', 92_980],
  ['KOPTONE08', 74_980], ['SABENKEL', 49_300], ['WELLNESSL', 48_380],
  ['FURKANKK61', 37_360], ['BUROLEC', 16_560], ['NICORY', 0],
].map(([name, crewRep]) => ({ name, crewRep }));

const numeric = value => {
  const parsed = Number(String(value ?? 0).replace(/[^\d-]/gu, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const dayKey = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
const memberName = item => String(item?.name || item?.personaName || item?.personaname || item?.persona || '').trim();
const memberRep = item => numeric(item?.crewRep ?? item?.crew_rep ?? item?.recent_rep ?? item?.reputation ?? item?.points ?? item?.rep);

export function normalizeRoster(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map(item => ({ name: memberName(item), crewRep: memberRep(item) }))
    .filter(item => item.name && item.name.length <= 32 && !seen.has(item.name.toLocaleLowerCase('en-US')) && seen.add(item.name.toLocaleLowerCase('en-US')))
    .sort((a, b) => b.crewRep - a.crewRep || a.name.localeCompare(b.name));
}

export function normalizeProfile(profile, fallbackName) {
  if (!profile || typeof profile !== 'object') throw new Error('Sürücü profili geçersiz.');
  return {
    name: String(profile.name || fallbackName).slice(0, 32),
    lastLogin: profile.last_login || profile.lastLogin || null,
    eventsCompleted: numeric(profile.races ?? profile.eventsCompleted),
    driverScore: numeric(profile.score ?? profile.driverScore),
    level: numeric(profile.level),
  };
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}

export function createCrewTracker(store, config = {}, { fetcher = fetch, now = Date.now, logger = () => {} } = {}) {
  const homeGuildId = config.allowedGuildIds?.[0] || config.guildId;
  const auth = config.nightriderz || {};
  let timer;
  let running;

  async function request(method, parameters, authenticated = false) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://nightriderz.world', Referer: 'https://nightriderz.world/' };
    if (authenticated) {
      if (!auth.userKey || !auth.personaKey) throw new Error('NightRiderz Crew oturumu yapılandırılmadı.');
      headers['easharpptr-u'] = auth.userKey;
      headers['easharpptr-p'] = auth.personaKey;
    }
    const response = await fetcher(API_URL, { method: 'POST', headers, body: JSON.stringify({ serviceName: method === 'GetPlayerNext' ? 'players' : 'crew', methodName: method, parameters }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`NightRiderz API ${response.status}`);
    return response.json();
  }

  function getStatus(guildId = homeGuildId) {
    if (!guildId || guildId !== homeGuildId) return { enabled: false, crewId: NRZ_CREW_ID, sourceUrl: NRZ_CREW_URL, members: [], error: 'Crew takibi bu sunucu için yapılandırılmadı.' };
    return store.getRecord(guildId, 'crew_current', 'current') || { enabled: true, crewId: NRZ_CREW_ID, sourceUrl: NRZ_CREW_URL, members: [], updatedAt: null, refreshing: Boolean(running), exactRoster: Boolean(auth.userKey && auth.personaKey) };
  }

  async function refresh(guildId = homeGuildId, force = false) {
    if (!guildId || guildId !== homeGuildId) throw new Error('Crew takibi bu sunucu için yapılandırılmadı.');
    const current = store.getRecord(guildId, 'crew_current', 'current');
    if (!force && current?.updatedAt && now() - current.updatedAt < 15 * 60_000) return current;
    if (running) return running;
    running = (async () => {
      let roster = store.getRecord(guildId, 'crew_roster', 'current')?.members || INITIAL_CREW_MEMBERS;
      let exactRoster = false;
      let rosterError = null;
      if (auth.userKey && auth.personaKey) {
        try {
          const live = normalizeRoster(await request('GetMembersRep', [NRZ_CREW_ID], true));
          if (live.length) { roster = live; exactRoster = true; store.putRecord(guildId, 'crew_roster', 'current', { members: live, updatedAt: now(), source: 'NightRiderz Members' }); }
        } catch (error) { rosterError = error.message; }
      }
      const previous = store.getRecord(guildId, 'crew_current', 'current');
      const previousByName = new Map((previous?.members || []).map(item => [item.name.toLocaleLowerCase('en-US'), item]));
      let profileFailures = 0;
      const profiles = await mapLimit(roster, 4, async member => {
        const old = previousByName.get(member.name.toLocaleLowerCase('en-US'));
        try { return { ...member, ...normalizeProfile(await request('GetPlayerNext', [member.name]), member.name) }; }
        catch { profileFailures++; return { ...member, lastLogin: old?.lastLogin || null, eventsCompleted: old?.eventsCompleted || 0, driverScore: old?.driverScore || 0, level: old?.level || 0 }; }
      });
      const timestamp = now(), date = dayKey(timestamp), storedDay = store.getRecord(guildId, 'crew_daily', date);
      const baseline = storedDay?.baseline || profiles.map(item => ({ name: item.name, crewRep: item.crewRep, eventsCompleted: item.eventsCompleted, driverScore: item.driverScore }));
      const baselineByName = new Map(baseline.map(item => [item.name.toLocaleLowerCase('en-US'), item]));
      const members = profiles.map(item => {
        const base = baselineByName.get(item.name.toLocaleLowerCase('en-US')) || item;
        const old = previousByName.get(item.name.toLocaleLowerCase('en-US')) || item;
        return { ...item, dailyCrewRep: item.crewRep - numeric(base.crewRep), dailyEvents: item.eventsCompleted - numeric(base.eventsCompleted), dailyDriverScore: item.driverScore - numeric(base.driverScore), crewRepChange: item.crewRep - numeric(old.crewRep) };
      }).sort((a, b) => b.dailyCrewRep - a.dailyCrewRep || b.crewRep - a.crewRep);
      const totals = members.reduce((sum, item) => ({ crewRep: sum.crewRep + item.crewRep, dailyCrewRep: sum.dailyCrewRep + Math.max(0, item.dailyCrewRep), dailyEvents: sum.dailyEvents + Math.max(0, item.dailyEvents), dailyDriverScore: sum.dailyDriverScore + item.dailyDriverScore }), { crewRep: 0, dailyCrewRep: 0, dailyEvents: 0, dailyDriverScore: 0 });
      const status = { enabled: true, crewId: NRZ_CREW_ID, sourceUrl: NRZ_CREW_URL, updatedAt: timestamp, date, exactRoster, profileFailures, rosterError, members, ...totals };
      store.putRecord(guildId, 'crew_current', 'current', status);
      store.putRecord(guildId, 'crew_daily', date, { baseline, updatedAt: timestamp, dailyCrewRep: totals.dailyCrewRep, dailyEvents: totals.dailyEvents, dailyDriverScore: totals.dailyDriverScore });
      store.addLog(guildId, { type: 'crew.refreshed', actorId: null, message: `${members.length} Crew üyesinin REP ve profil istatistikleri güncellendi.`, details: { crewId: NRZ_CREW_ID, exactRoster, profileFailures, dailyCrewRep: totals.dailyCrewRep } });
      return status;
    })().catch(error => {
      logger('error', 'crew_refresh_failed', { code: error.code || 'UNKNOWN' });
      const fallback = { ...getStatus(guildId), error: 'Crew verileri güncellenemedi; son başarılı kayıt gösteriliyor.', refreshing: false };
      if (fallback.members?.length) store.putRecord(guildId, 'crew_current', 'current', fallback);
      return fallback;
    }).finally(() => { running = null; });
    return running;
  }

  async function initialize() {
    if (!homeGuildId) return;
    await refresh(homeGuildId, true);
    timer = setInterval(() => void refresh(homeGuildId).catch(() => {}), 60 * 60_000);
    timer.unref();
  }
  return { initialize, refresh, getStatus, close() { clearInterval(timer); } };
}
