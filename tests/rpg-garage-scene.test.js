import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGarageInteractive } from '../public/rpg-garage-interactive.js';

test('garage scene uses owned cars, stored parts, delivered equipment and server work time', () => {
  const now = 1_800_000;
  const garage = { capacity: 3, upgrades: [
    { id: 'krom-set', category: 'tools', name: 'Krom Set', symbol: '🧰', price: 800, owned: true, equipped: true, durability: 24 },
    { id: 'makasli-lift', category: 'lift', name: 'Makaslı Lift', symbol: '🏗️', price: 1200, owned: false, readyAt: now + 60_000 },
  ] };
  const vehicles = { depot: { filter: 1 }, vehicles: [
    { id: 'car-1', status: 'broken', model: { name: 'Şehir Hatchback', symbol: '🚗', parts: { filter: 1, brake: 1 } } },
  ] };
  const html = renderGarageInteractive(garage, vehicles, { now, world: { night: true }, activity: { type: 'work', startedAt: now - 10_000, endsAt: now + 10_000 } });
  assert.equal((html.match(/data-rpg-scene-bay=/g) || []).length, 3);
  assert.match(html, /Şehir Hatchback/);
  assert.match(html, /aria-valuenow="50"/);
  assert.match(html, /data-rpg-scene-progress data-started-at="1790000" data-ends-at="1810000"/);
  assert.match(html, /is-night/);
  assert.match(html, /class="rpg-scene-gear-chip  worn"/);
  assert.match(html, /Kargoda/);
  assert.doesNotMatch(renderGarageInteractive(garage, vehicles, { now }), /data-rpg-scene-progress/);
});
