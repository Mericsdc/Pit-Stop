import { createHash, randomUUID } from 'node:crypto';
import { dateKey, credit, requireRpg } from './rpg-system.js';
import { garageLevel } from './rpg-garage.js';

export const VEHICLE_PARTS = Object.freeze([
  { id: 'filter', name: 'Yağ filtresi', price: 45, symbol: '◉' },
  { id: 'brake', name: 'Fren balatası', price: 85, symbol: '◫' },
  { id: 'battery', name: 'Akü', price: 110, symbol: '▣' },
  { id: 'tire', name: 'Lastik', price: 120, symbol: '◎' },
  { id: 'belt', name: 'Motor kayışı', price: 145, symbol: '⌁' },
  { id: 'panel', name: 'Kaporta paneli', price: 180, symbol: '▤' },
  { id: 'turbo', name: 'Turbo ünitesi', price: 320, symbol: '✦' },
]);

export const VEHICLE_MODELS = Object.freeze([
  { id: 'compact', name: 'Şehir Hatchback', class: 'D', level: 1, price: 450, value: 820, parts: { filter: 1, brake: 1 }, symbol: '🚗' },
  { id: 'sedan', name: 'Garaj Sedanı', class: 'C', level: 3, price: 950, value: 1660, parts: { battery: 1, tire: 1, filter: 1 }, symbol: '🚙' },
  { id: 'coupe', name: 'Sokak Coupe', class: 'B', level: 5, price: 2100, value: 3600, parts: { belt: 1, brake: 2, panel: 1 }, symbol: '🏎️' },
  { id: 'supercar', name: 'Pist Süper Spor', class: 'A', level: 8, price: 5400, value: 9000, parts: { turbo: 1, tire: 2, panel: 2 }, symbol: '🏎️' },
  { id: 'hypercar', name: 'Pit-Stop Hypercar', class: 'S', level: 10, price: 14500, value: 24000, parts: { turbo: 2, battery: 2, panel: 2 }, symbol: '🏁' },
]);

const daySeed = (guildId, playerId, day) => createHash('sha256').update(`${guildId}:${playerId}:${day}:garage-jobs`).digest();
const repairNeeds = (parts, level) => Object.fromEntries(Object.entries(parts).map(([id, count]) => [id, Math.min(3, Math.max(1, count - (level >= 7 ? 1 : 0)))]));
const hasParts = (depot, needs) => Object.entries(needs).every(([id, count]) => Number(depot[id] || 0) >= count);
const consumeParts = (depot, needs) => { for (const [id, count] of Object.entries(needs)) depot[id] -= count; };

export function normalizeVehicles(player, time) {
  const garage = player.garage;
  garage.depot = garage.depot && typeof garage.depot === 'object' && !Array.isArray(garage.depot) ? garage.depot : {};
  garage.vehicles = Array.isArray(garage.vehicles) ? garage.vehicles : [];
  garage.repairJobs = garage.repairJobs && typeof garage.repairJobs === 'object' ? garage.repairJobs : {};
  const day = dateKey(time);
  if (garage.repairJobs.date !== day) garage.repairJobs = { date: day, level: garageLevel(garage.xp).level, completed: [] };
  if (!Array.isArray(garage.repairJobs.completed)) garage.repairJobs.completed = [];
  return garage;
}

export function dailyRepairJobs(guildId, playerId, player, time) {
  const garage = normalizeVehicles(player, time), seed = daySeed(guildId, playerId, garage.repairJobs.date);
  const level = Number(garage.repairJobs.level) || garageLevel(garage.xp).level;
  const available = VEHICLE_MODELS.filter(model => model.level <= level);
  return [0, 1, 2].map(index => {
    const model = available[seed[index] % available.length];
    const needs = repairNeeds(model.parts, level);
    return {
      id: `${garage.repairJobs.date}:${index}`, modelId: model.id, name: model.name,
      class: model.class, symbol: model.symbol, parts: needs,
      reward: Math.max(100, Math.floor(model.value * (0.25 + (seed[index + 3] % 10) / 100))),
      xp: 30 + model.level * 15, completed: garage.repairJobs.completed.includes(index),
      ready: hasParts(garage.depot, needs),
    };
  });
}

export function vehicleState(guildId, playerId, player, time) {
  const garage = normalizeVehicles(player, time), rank = garageLevel(garage.xp);
  return {
    depot: garage.depot, vehicles: garage.vehicles.map(car => { const model = VEHICLE_MODELS.find(item => item.id === car.modelId) || null; return { ...car, model, openingBid: model ? auctionOpeningPrice(player, model) : null }; }),
    jobs: dailyRepairJobs(guildId, playerId, player, time),
    parts: VEHICLE_PARTS, models: VEHICLE_MODELS.map(model => ({ ...model, price: Math.floor(model.price * (garage.owned.includes('boya-kabini') ? 0.9 : 1)), unlocked: rank.level >= model.level })),
    capacity: rank.capacity, occupied: garage.vehicles.length,
    nextJobsAt: Date.parse(`${dateKey(time + 86_400_000)}T00:00:00+03:00`),
  };
}

export function vehicleAction(player, guildId, playerId, action, choice, time) {
  const garage = normalizeVehicles(player, time), rank = garageLevel(garage.xp);
  if (action === 'partBuy') {
    const part = VEHICLE_PARTS.find(item => item.id === choice);
    requireRpg(part, 'Bu yedek parça bulunamadı.');
    requireRpg(player.coins >= part.price, 'Yedek parça için PitCoin bakiyen yetersiz.');
    requireRpg(Number(garage.depot[part.id] || 0) < 999, 'Bu parçadan depoda en fazla 999 adet tutulabilir.');
    player.coins -= part.price; garage.depot[part.id] = Number(garage.depot[part.id] || 0) + 1;
    return `${part.name} depoya eklendi. -${part.price} PitCoin.`;
  }
  if (action === 'jobRepair') {
    const job = dailyRepairJobs(guildId, playerId, player, time).find(item => item.id === choice);
    requireRpg(job, 'Bu günlük tamir işi bulunamadı veya süresi doldu.');
    requireRpg(!job.completed, 'Bu müşteri aracı zaten tamir edildi.');
    requireRpg(job.ready, 'Bu aracı tamir etmek için depodaki parçalar yetersiz.');
    consumeParts(garage.depot, job.parts);
    garage.repairJobs.completed.push(Number(choice.split(':')[1]));
    credit(player, job.reward, 0);
    garage.xp += job.xp;
    return `${job.name} tamir edildi. +${job.reward} PitCoin · +${job.xp} Garaj XP.`;
  }
  if (action === 'carBuy') {
    const model = VEHICLE_MODELS.find(item => item.id === choice);
    requireRpg(model, 'Bu araç galeride bulunamadı.');
    requireRpg(rank.level >= model.level, `Bu araç için Garaj Seviye ${model.level} gerekli.`);
    requireRpg(rank.capacity == null || garage.vehicles.length < rank.capacity, 'Garajında boş araç yeri yok.');
    const price = Math.floor(model.price * (garage.owned.includes('boya-kabini') ? 0.9 : 1));
    requireRpg(player.coins >= price, 'Bu araç için PitCoin bakiyen yetersiz.');
    player.coins -= price;
    garage.vehicles.push({ id: randomUUID(), modelId: model.id, status: 'broken', boughtAt: time, paid: price });
    return `${model.name} satın alındı. Garajında onarım bekliyor. -${price} PitCoin.`;
  }
  if (action === 'carRepair') {
    const car = garage.vehicles.find(item => item.id === choice), model = VEHICLE_MODELS.find(item => item.id === car?.modelId);
    requireRpg(car && model, 'Bu araç garajında bulunamadı.');
    requireRpg(car.status === 'broken', 'Bu araç zaten tamir edildi veya açık artırmada.');
    requireRpg(hasParts(garage.depot, model.parts), 'Bu aracı tamir etmek için depodaki parçalar yetersiz.');
    consumeParts(garage.depot, model.parts); car.status = 'repaired'; car.repairedAt = time;
    garage.xp += 40 + model.level * 15;
    return `${model.name} tamir edildi. Açık artırmaya çıkarabilirsin. +${40 + model.level * 15} Garaj XP.`;
  }
  throw new Error('Geçersiz araç işlemi.');
}

export function auctionOpeningPrice(player, model) {
  const garage = player.garage;
  const bonus = (garage.owned.includes('yikama-alani') ? 5 : 0) + (garage.owned.includes('boya-kabini') ? 10 : 0);
  return Math.floor(model.value * (1 + bonus / 100));
}
