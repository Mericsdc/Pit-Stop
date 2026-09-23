import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/rpg-system.js';
import { garageAction, garageState, garageWorkDuration, resolveGarageShift } from '../src/rpg-garage.js';

const user = () => normalize({ coins: 30_000, xp: 0 }, 'Pilot', 1_000_000);
const highRoll = (min, max) => max - 1;

test('legacy RPG players receive a safe level-one garage without losing their economy', () => {
  const player = user(), garage = garageState(player, 1_000_000);
  assert.equal(player.coins, 30_000);
  assert.equal(garage.level, 1);
  assert.equal(garage.capacity, 1);
  assert.deepEqual(garage.owned.slice(0, 2), ['pasli-aletler', 'timsah-kriko']);
});

test('garage purchases enforce level gates and hydraulic lift unlocks an employee', () => {
  const player = user();
  assert.throws(() => garageAction(player, 'garageBuy', 'hidrolik-lift', { time: 1_000_000, roll: highRoll }), /Seviye 5/u);
  player.garage.xp = 2_400;
  garageAction(player, 'garageBuy', 'hidrolik-lift', { time: 1_000_000, roll: highRoll });
  assert.throws(() => garageAction(player, 'hireEmployee', null, { time: 1_000_000, roll: highRoll }), /Hidrolik Lift/u);
  garageAction(player, 'hireEmployee', null, { time: 1_000_000 + 15 * 60_000, roll: highRoll });
  const garage = garageState(player, 1_000_000 + 15 * 60_000);
  assert.equal(garage.employee.title, 'Çırak');
  assert.equal(garage.employee.morale, 100);
  assert.equal(garage.equipped.employeeTools, 'pasli-yedek');
  assert.equal(garage.equipped.employeeStation, 'palet-kriko');
});

test('garage equipment shortens server-side shifts and a shift advances garage progression', () => {
  const player = user(); player.garage.xp = 2_400; player.garage.owned.push('hidrolik-lift'); player.garage.equipped.lift = 'hidrolik-lift';
  assert.equal(garageWorkDuration(player), 20 * 60_000);
  const result = resolveGarageShift(player, { time: 1_000_000, roll: highRoll, baseGold: 100, baseXp: 35 });
  assert.equal(result.gold, 110);
  assert.equal(result.garageXp, 45);
  assert.equal(player.garage.shifts, 1);
  assert.equal(player.garage.xp, 2_445);
});

test('employee passive income, morale and equipment repair remain server authoritative', () => {
  const player = user(); player.garage.xp = 2_400; player.garage.owned.push('hidrolik-lift'); player.garage.equipped.lift = 'hidrolik-lift';
  garageAction(player, 'hireEmployee', null, { time: 1_000_000, roll: highRoll });
  player.garage.employee.lastCollectedAt = 1_000_000 - 2 * 3_600_000;
  const before = player.coins;
  garageAction(player, 'employeeCollect', null, { time: 1_000_000, roll: highRoll });
  assert.equal(player.coins, before + 20);
  assert.equal(player.garage.employee.morale, 98);
  player.garage.employee.durability = { tools: 90, station: 80 };
  const beforeRepair = player.coins;
  garageAction(player, 'repairEmployee', null, { time: 1_000_000, roll: highRoll });
  assert.equal(player.coins, beforeRepair - 90);
  assert.deepEqual(player.garage.employee.durability, { tools: 100, station: 100 });
});

test('roadside assistance requires a tow truck and applies a durable cooldown', () => {
  const player = user(); player.garage.xp = 1_400;
  assert.throws(() => garageAction(player, 'roadside', null, { time: 1_000_000, roll: highRoll }), /çekici/u);
  garageAction(player, 'garageBuy', 'ikinci-el-cekici', { time: 1_000_000, roll: highRoll });
  const result = garageAction(player, 'roadside', null, { time: 1_000_000 + 15 * 60_000, roll: highRoll });
  assert.match(result, /başarıyla kurtarıldı/u);
  assert.equal(player.garage.roadsideCooldown, 1_000_000 + 45 * 60_000);
  assert.throws(() => garageAction(player, 'roadside', null, { time: 1_000_000 + 15 * 60_000 + 1, roll: highRoll }), /operasyonda/u);
});

test('delivery can be expedited and worn equipment loses its bonus until repaired', () => {
  const player = user(); player.garage.xp = 2_400;
  garageAction(player, 'garageBuy', 'krom-set', { time: 1_000_000, roll: highRoll });
  assert.equal(garageState(player, 1_000_000).upgrades.find(item => item.id === 'krom-set').owned, false);
  garageAction(player, 'garageExpedite', 'krom-set', { time: 1_000_000, roll: highRoll });
  assert.equal(player.garage.equipped.tools, 'krom-set');
  player.garage.durability['krom-set'] = 1;
  resolveGarageShift(player, { time: 1_000_000, roll: highRoll, baseGold: 100, baseXp: 35 });
  assert.equal(player.garage.durability['krom-set'], 0);
  const withoutBonus = resolveGarageShift(player, { time: 1_000_001, roll: highRoll, baseGold: 100, baseXp: 35 });
  assert.equal(withoutBonus.gold, 110);
  garageAction(player, 'repairUpgrade', 'krom-set', { time: 1_000_002, roll: highRoll });
  assert.equal(player.garage.durability['krom-set'], 100);
});
