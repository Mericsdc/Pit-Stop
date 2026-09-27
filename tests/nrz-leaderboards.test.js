import assert from 'node:assert/strict';
import test from 'node:test';
import { createNrzLeaderboards, formatRaceTime } from '../src/nrz-leaderboards.js';

function fixture() {
  const calls = [];
  const cards = [
    { race: { id: '239', name: 'AGATHE STREET ', eventModeId: '9', isEnabled: '1', carClassHash: '86241155' } },
    { race: { id: '5239', name: 'AGATHE STREET  [TA]', eventModeId: '9', isEnabled: '1' } },
    { race: { id: '610', name: 'SOLO RACE ', eventModeId: '4', isEnabled: '0' } },
    { race: { id: '2239', name: 'RANKED AGATHE', eventModeId: '9', rankedMode: '1' } },
  ];
  const hit = (name, ms, hash) => ({ persona: [{ name }], car: { manufactor: 'BMW', model: 'Z4 GT3', rating: 799, eventDataSetupHash: hash }, race: { eventDurationInMilliseconds: ms } });
  const hash = 'a'.repeat(40);
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    let result;
    if (body.methodName === 'GetCards') result = cards;
    else if (body.methodName === 'GetData') result = { event: { hits: body.parameters[0] === '239' ? [hit('Slow', 99000, hash), hit('Fast', 92001, hash)] : [hit('Attack', 91000, hash)] } };
    else if (body.methodName === 'getCarsInfoHash') result = { carRating: '799', PERFORMANCEPART: [{ longDescription: 'Elite Engine' }], SKILLMODPART: [{ longDescription: 'Perfect Start' }], VISUALPART: [] };
    return { ok: true, json: async () => result };
  };
  return { api: createNrzLeaderboards({ fetcher }), calls };
}

test('catalog includes inactive races, pairs Time Attack, and excludes ranked races', async () => {
  const { api, calls } = fixture();
  const maps = await api.catalog();
  assert.equal(maps.length, 2);
  assert.equal(maps[0].timeAttackId, 5239);
  assert.equal(maps[1].timeAttackId, null);
  await api.catalog();
  assert.equal(calls.filter(call => call.methodName === 'GetCards').length, 1);
});

test('map resolves case-insensitive name, sorts records and loads setup parts once', async () => {
  const { api, calls } = fixture();
  const result = await api.getMap('agathe street');
  assert.equal(result.map.id, 239);
  assert.deepEqual(result.normal.map(row => row.driver), ['Fast', 'Slow']);
  assert.equal(result.timeAttack[0].milliseconds, 91000);
  assert.deepEqual(result.normal[0].tuning.performance, ['Elite Engine']);
  assert.deepEqual(calls.filter(call => call.methodName === 'GetData').map(call => call.parameters.slice(0, 3)), [['239', 1, 0], ['5239', 1, 1]]);
  assert.equal(calls.filter(call => call.methodName === 'getCarsInfoHash').length, 1);
  assert.equal(formatRaceTime(92001), '1:32.001');
});

test('ambiguous names return suggestions and a race without TA returns empty TA rows', async () => {
  const { api } = fixture();
  const suggestions = await api.findMap('race');
  assert.equal(suggestions.map.name, 'SOLO RACE');
  const result = await api.getMap('solo race');
  assert.deepEqual(result.timeAttack, []);
  assert.equal(result.map.active, false);
});
