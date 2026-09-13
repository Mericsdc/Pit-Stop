import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrewTracker, INITIAL_CREW_MEMBERS, normalizeProfile, normalizeRoster } from '../src/crew.js';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';

test('NightRiderz roster and public profiles are normalized defensively', () => {
  assert.deepEqual(normalizeRoster([{ name: 'Pilot', reputation: '1,250' }, { personaName: 'Pilot', points: 2 }, { personaname: 'Racer', crew_rep: 99 }]), [{ name: 'Pilot', crewRep: 1250 }, { name: 'Racer', crewRep: 99 }]);
  assert.deepEqual(normalizeProfile({ name: 'Pilot', last_login: '2026-09-13 10:00:00', races: '599', score: '6,435', level: '98' }, 'x'), { name: 'Pilot', lastLogin: '2026-09-13 10:00:00', eventsCompleted: 599, driverScore: 6435, level: 98 });
  assert.equal(INITIAL_CREW_MEMBERS.length, 33);
  assert.equal(INITIAL_CREW_MEMBERS.reduce((sum, member) => sum + member.crewRep, 0), 38_588_670);
});

test('crew tracker stores daily REP, event and score comparisons from live Members data', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  let time = Date.parse('2026-09-13T07:00:00Z'), round = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.methodName === 'GetMembersRep') return Response.json(round ? [{ name: 'Pilot', reputation: '1,450' }, { name: 'Racer', reputation: '650' }] : [{ name: 'Pilot', reputation: '1,250' }, { name: 'Racer', reputation: '500' }]);
    const name = body.parameters[0], pilot = name === 'Pilot';
    return Response.json({ name, last_login: '2026-09-13 10:00:00', races: (pilot ? 10 : 5) + round, score: (pilot ? 100 : 50) + round * 10, level: 20 });
  };
  const tracker = createCrewTracker(store, { allowedGuildIds: [GUILD], nightriderz: { userKey: 'reader', personaKey: 'persona' } }, { fetcher, now: () => time });
  await tracker.refresh(GUILD, true);
  round = 1; time += 3600_000;
  const current = await tracker.refresh(GUILD, true);
  assert.equal(current.exactRoster, true);
  assert.equal(current.dailyCrewRep, 350);
  assert.equal(current.dailyEvents, 2);
  assert.equal(current.dailyDriverScore, 20);
  assert.equal(current.members.find(member => member.name === 'Pilot').dailyCrewRep, 200);
  assert.equal(store.getRecord(GUILD, 'crew_daily', '2026-09-13').dailyCrewRep, 350);
  tracker.close();
});
