import assert from 'node:assert/strict';
import test from 'node:test';
import { CREW_REFRESH_INTERVAL, createCrewTracker, INITIAL_CREW_MEMBERS, normalizeCrewActivity, normalizeProfile, normalizeRoster } from '../src/crew.js';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';

test('NightRiderz roster and public profiles are normalized defensively', () => {
  assert.deepEqual(normalizeRoster([{ name: 'Pilot', reputation: '1,250' }, { personaName: 'Pilot', points: 2 }, { personaname: 'Racer', crew_rep: 99 }]), [{ name: 'Pilot', crewRep: 1250 }, { name: 'Racer', crewRep: 99 }]);
  assert.deepEqual(normalizeProfile({ name: 'Pilot', last_login: '2026-09-13 10:00:00', races: '599', score: '6,435', level: '98' }, 'x'), { name: 'Pilot', lastLogin: '2026-09-13 10:00:00', eventsCompleted: 599, driverScore: 6435, level: 98 });
  assert.equal(INITIAL_CREW_MEMBERS.length, 33);
  assert.equal(INITIAL_CREW_MEMBERS.reduce((sum, member) => sum + member.crewRep, 0), 38_588_670);
});

test('crew activity is matched by nickname for rolling, daily and monthly REP', () => {
  const now = Date.parse('2026-09-14T15:00:00Z');
  const activity = normalizeCrewActivity([
    { pseudo: 'Pilot', points: '+5,000 rep', date: '2026-09-14T14:00:00Z', reason: 'race' },
    { pseudo: 'Pilot', points: '2,000', date: '2026-09-13T15:30:00Z', is_race: 1 },
    { pseudo: 'Pilot', points: '99,000', date: '2026-09-01T10:00:00Z', reason: 'join' },
  ], now);
  assert.deepEqual(activity.get('pilot'), { last24hCrewRep: 7000, dailyActivityRep: 5000, monthlyActivityRep: 7000 });
});

test('crew tracker stores daily REP, event and score comparisons from live Members data', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  let time = Date.parse('2026-09-12T07:00:00Z'), round = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.methodName === 'GetMembersRep') return Response.json(round ? [{ name: 'Pilot', reputation: '1,450' }, { name: 'Racer', reputation: '650' }] : [{ name: 'Pilot', reputation: '1,250' }, { name: 'Racer', reputation: '500' }]);
    const name = body.parameters[0], pilot = name === 'Pilot';
    return Response.json({ name, last_login: '2026-09-13 10:00:00', races: (pilot ? 10 : 5) + round, score: (pilot ? 100 : 50) + round * 10, level: 20 });
  };
  const tracker = createCrewTracker(store, { allowedGuildIds: [GUILD], nightriderz: { userKey: 'reader', personaKey: 'persona' } }, { fetcher, now: () => time });
  await tracker.refresh(GUILD, true);
  round = 1; time += 24 * 3600_000;
  const current = await tracker.refresh(GUILD, true);
  assert.equal(current.exactRoster, true);
  assert.equal(current.referenceDate, '2026-09-12');
  assert.equal(current.comparisonAvailable, true);
  assert.equal(current.dailyCrewRep, 350);
  assert.equal(current.instantCrewRep, 350);
  assert.equal(current.last24hCrewRep, 350);
  assert.equal(current.monthlyCrewRep, 350);
  assert.equal(current.dailyEvents, 2);
  assert.equal(current.dailyDriverScore, 20);
  assert.equal(current.members.find(member => member.name === 'Pilot').dailyCrewRep, 200);
  assert.equal(store.getRecord(GUILD, 'crew_daily', '2026-09-13').dailyCrewRep, 350);
  assert.equal(current.refreshIntervalMs, CREW_REFRESH_INTERVAL);
  assert.equal(store.getLogs(GUILD).length, 0);
  await tracker.refresh(GUILD, true, { log: true, actorId: '1400000000000000001', actorName: 'Pilot' });
  assert.equal(store.getLogs(GUILD).length, 1);
  assert.equal(store.getLogs(GUILD)[0].actorId, '1400000000000000001');
  assert.match(store.getLogs(GUILD)[0].message, /elle yeniledi/u);
  tracker.close();
});

test('crew tracker uses the first same-day snapshot for live daily REP', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  let time = Date.parse('2026-09-14T07:00:00Z'), reputation = 1000;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.methodName === 'GetMembersRep') return Response.json([{ name: 'Pilot', reputation }]);
    return Response.json({ name: 'Pilot', last_login: '2026-09-14 10:00:00', races: 10, score: 100, level: 20 });
  };
  const tracker = createCrewTracker(store, { allowedGuildIds: [GUILD], nightriderz: { userKey: 'reader', personaKey: 'persona' } }, { fetcher, now: () => time });
  const first = await tracker.refresh(GUILD, true);
  assert.equal(first.referenceDate, '2026-09-14');
  assert.equal(first.comparisonAvailable, true);
  assert.equal(first.dailyCrewRep, 0);
  reputation = 1250; time += 3 * 60_000;
  const current = await tracker.refresh(GUILD, true);
  assert.equal(current.dailyCrewRep, 250);
  assert.equal(current.instantCrewRep, 0);
  tracker.close();
});

test('first authenticated roster refresh replaces an old seed baseline', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  const date = '2026-09-14';
  store.putRecord(GUILD, 'crew_current', 'current', { exactRoster: false, members: [{ name: 'Pilot', crewRep: 100 }] });
  store.putRecord(GUILD, 'crew_daily', date, { reference: [{ name: 'Pilot', crewRep: 100 }], referenceDate: date, latest: [{ name: 'Pilot', crewRep: 100 }] });
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.methodName === 'GetMembersRep') return Response.json([{ name: 'Pilot', reputation: 5000 }]);
    return Response.json({ name: 'Pilot', races: 20, score: 200, level: 30 });
  };
  const tracker = createCrewTracker(store, { allowedGuildIds: [GUILD], nightriderz: { userKey: 'reader', personaKey: 'persona' } }, { fetcher, now: () => Date.parse('2026-09-14T09:00:00Z') });
  const current = await tracker.refresh(GUILD, true);
  assert.equal(current.exactRoster, true);
  assert.equal(current.dailyCrewRep, 0);
  assert.equal(store.getRecord(GUILD, 'crew_daily', date).reference[0].crewRep, 5000);
  tracker.close();
});
