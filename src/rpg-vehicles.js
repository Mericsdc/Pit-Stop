import { createHash, randomUUID } from 'node:crypto';
import { dateKey, credit, requireRpg, world } from './rpg-system.js';
import { garageLevel } from './rpg-garage.js';

export const VEHICLE_PARTS = Object.freeze([
  { id: 'filter', name: 'Yağ filtresi', price: 45, symbol: '◉', rarity: 1 },
  { id: 'brake', name: 'Fren balatası', price: 85, symbol: '◫', rarity: 1 },
  { id: 'battery', name: 'Akü', price: 110, symbol: '▣', rarity: 1 },
  { id: 'tire', name: 'Lastik', price: 120, symbol: '◎', rarity: 1 },
  { id: 'belt', name: 'Motor kayışı', price: 145, symbol: '⌁', rarity: 1 },
  { id: 'panel', name: 'Kaporta paneli', price: 180, symbol: '▤', rarity: 1 },
  { id: 'turbo', name: 'Turbo ünitesi', price: 320, symbol: '✦', rarity: 2 },
  { id: 'alloy-wheel', name: 'Alaşım jant', price: 380, symbol: '◈', rarity: 2 },
  { id: 'aero-spoiler', name: 'Aero spoiler', price: 420, symbol: '➤', rarity: 2 },
  { id: 'tint-film', name: 'Cam filmi', price: 220, symbol: '▥', rarity: 1 },
  { id: 'vinyl-wrap', name: 'Vinil kaplama', price: 460, symbol: '◩', rarity: 2 },
  { id: 'race-exhaust', name: 'Performans egzozu', price: 580, symbol: '≈', rarity: 2 },
  { id: 'engine-block', name: 'Güçlendirilmiş motor bloğu', price: 900, symbol: '⬡', rarity: 3 },
  { id: 'race-suspension', name: 'Yarış süspansiyonu', price: 720, symbol: '⌁', rarity: 3 },
  { id: 'carbon-kit', name: 'Karbon aero kit', price: 1350, symbol: '◆', rarity: 3, market: 'daily', stock: 2 },
  { id: 'twin-turbo', name: 'İkiz turbo seti', price: 2200, symbol: '✶', rarity: 4, market: 'weekly', stock: 1 },
  { id: 'race-ecu', name: 'Yarış ECU', price: 1700, symbol: '▦', rarity: 4, market: 'weekly', stock: 1 },
]);

export const VEHICLE_BOXES = Object.freeze([
  { id: 'standard', name: 'Standart modifiye kutusu', price: 260, minRarity: 1, maxRarity: 2, symbol: '▤' },
  { id: 'rare', name: 'Nadir modifiye kutusu', price: 600, minRarity: 2, maxRarity: 3, symbol: '◈' },
  { id: 'epic', name: 'Epik modifiye kutusu', price: 1250, minRarity: 3, maxRarity: 4, symbol: '✦' },
  { id: 'legendary', name: 'Efsanevi modifiye kutusu', price: 2500, minRarity: 4, maxRarity: 4, symbol: '✶' },
]);

export const VEHICLE_MODS = Object.freeze([
  { id: 'wheels', name: 'Alaşım jant', slot: 'wheels', type: 'visual', part: 'alloy-wheel', fee: 120, level: 2, value: 260, race: 4, chance: 95 },
  { id: 'tint', name: 'Cam filmi', slot: 'windows', type: 'visual', part: 'tint-film', fee: 75, level: 1, value: 150, race: 0, chance: 100 },
  { id: 'vinyl', name: 'Vinil kaplama', slot: 'paint', type: 'visual', part: 'vinyl-wrap', fee: 180, level: 3, value: 340, race: 0, chance: 90 },
  { id: 'spoiler', name: 'Aero spoiler', slot: 'spoiler', type: 'visual', part: 'aero-spoiler', fee: 190, level: 3, value: 310, race: 15, chance: 88 },
  { id: 'exhaust', name: 'Performans egzozu', slot: 'exhaust', type: 'performance', part: 'race-exhaust', fee: 220, level: 4, value: 420, race: 12, chance: 82 },
  { id: 'suspension', name: 'Yarış süspansiyonu', slot: 'suspension', type: 'performance', part: 'race-suspension', fee: 260, level: 5, value: 550, race: 18, chance: 78 },
  { id: 'engine', name: 'Güçlendirilmiş motor bloğu', slot: 'engine', type: 'performance', part: 'engine-block', fee: 350, level: 6, value: 850, race: 24, chance: 72 },
  { id: 'turbo', name: 'Turbo ünitesi', slot: 'turbo', type: 'performance', part: 'turbo', fee: 300, level: 5, value: 680, race: 20, chance: 76 },
  { id: 'carbon', name: 'Karbon aero kit', slot: 'spoiler', type: 'visual', part: 'carbon-kit', fee: 500, level: 7, value: 1250, race: 25, chance: 68 },
  { id: 'twin-turbo', name: 'İkiz turbo', slot: 'turbo', type: 'performance', part: 'twin-turbo', fee: 900, level: 9, value: 2150, race: 38, chance: 62 },
  { id: 'ecu', name: 'Yarış ECU kalibrasyonu', slot: 'ecu', type: 'performance', part: 'race-ecu', fee: 650, level: 8, value: 1600, race: 30, chance: 65 },
]);

export const VEHICLE_MODELS = Object.freeze([
  { id: 'compact', name: 'Şehir Hatchback', class: 'D', level: 1, price: 450, value: 820, parts: { filter: 1, brake: 1 }, symbol: '🚗' },
  { id: 'sedan', name: 'Garaj Sedanı', class: 'C', level: 3, price: 950, value: 1660, parts: { battery: 1, tire: 1, filter: 1 }, symbol: '🚙' },
  { id: 'coupe', name: 'Sokak Coupe', class: 'B', level: 5, price: 2100, value: 3600, parts: { belt: 1, brake: 2, panel: 1 }, symbol: '🏎️' },
  { id: 'supercar', name: 'Pist Süper Spor', class: 'A', level: 8, price: 5400, value: 9000, parts: { turbo: 1, tire: 2, panel: 2 }, symbol: '🏎️' },
  { id: 'hypercar', name: 'Pit-Stop Hypercar', class: 'S', level: 10, price: 14500, value: 24000, parts: { turbo: 2, battery: 2, panel: 2 }, symbol: '🏁' },
  { id: 'classic', name: 'Paslı Klasik', class: 'C', level: 2, price: 0, value: 2300, parts: { filter: 1, belt: 1, panel: 2 }, symbol: '🚘', gallery: false },
]);

const daySeed = (guildId, playerId, day) => createHash('sha256').update(`${guildId}:${playerId}:${day}:garage-jobs`).digest();
const repairNeeds = (parts, level) => Object.fromEntries(Object.entries(parts).map(([id, count]) => [id, Math.min(3, Math.max(1, count - (level >= 7 ? 1 : 0)))]));
const hasParts = (depot, needs) => Object.entries(needs).every(([id, count]) => Number(depot[id] || 0) >= count);
const consumeParts = (depot, needs) => { for (const [id, count] of Object.entries(needs)) depot[id] -= count; };
const weekKey = time => { const day = new Date(`${dateKey(time)}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); return day.toISOString().slice(0, 10); };
const partById = id => VEHICLE_PARTS.find(part => part.id === id);
const modById = id => VEHICLE_MODS.find(mod => mod.id === id);

export function carStats(car, model) {
  const mods = Array.isArray(car.mods) ? car.mods.map(modById).filter(Boolean) : [];
  return { mods, raceScore: 20 + model.level * 14 + mods.reduce((sum, mod) => sum + mod.race, 0), modValue: mods.reduce((sum, mod) => sum + mod.value, 0) };
}

export function modSuccessChance(player, mod) {
  const garage = player.garage, level = garageLevel(garage.xp).level;
  if (level >= 9 || garage.equipped.diagnostic === 'dyno' && Number(garage.durability?.dyno ?? 100) > 0) return 100;
  if (garage.equipped.diagnostic === 'tespit-tableti' && Number(garage.durability?.['tespit-tableti'] ?? 100) > 0) return Math.min(100, Math.round(100 - (100 - mod.chance) / 2));
  if (garage.equipped.diagnostic === 'obd2' && Number(garage.durability?.obd2 ?? 100) > 0) return Math.min(100, mod.chance + 5);
  return mod.chance;
}

export function normalizeVehicles(player, time) {
  const garage = player.garage;
  garage.depot = garage.depot && typeof garage.depot === 'object' && !Array.isArray(garage.depot) ? garage.depot : {};
  garage.vehicles = Array.isArray(garage.vehicles) ? garage.vehicles : [];
  garage.repairJobs = garage.repairJobs && typeof garage.repairJobs === 'object' ? garage.repairJobs : {};
  const day = dateKey(time);
  if (garage.repairJobs.date !== day) garage.repairJobs = { date: day, level: garageLevel(garage.xp).level, completed: [] };
  if (!Array.isArray(garage.repairJobs.completed)) garage.repairJobs.completed = [];
  garage.market = garage.market && typeof garage.market === 'object' ? garage.market : {};
  if (garage.market.day !== day) { garage.market.day = day; garage.market.dayBought = {}; }
  if (garage.market.week !== weekKey(time)) { garage.market.week = weekKey(time); garage.market.weekBought = {}; }
  garage.market.dayBought ||= {};
  garage.market.weekBought ||= {};
  garage.junkyardReadyAt = Number(garage.junkyardReadyAt) || 0;
  return garage;
}

export function dailyRepairJobs(guildId, playerId, player, time) {
  const garage = normalizeVehicles(player, time), seed = daySeed(guildId, playerId, garage.repairJobs.date);
  const level = Number(garage.repairJobs.level) || garageLevel(garage.xp).level;
  const available = VEHICLE_MODELS.filter(model => model.gallery !== false && model.level <= level);
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
  const marketOpen = world(time, guildId).marketOpen;
  return {
    depot: garage.depot, vehicles: garage.vehicles.map(car => { const model = VEHICLE_MODELS.find(item => item.id === car.modelId) || null; const stats = model ? carStats(car, model) : null; return { ...car, model, ...stats, openingBid: model ? auctionOpeningPrice(player, model, car) : null }; }),
    jobs: dailyRepairJobs(guildId, playerId, player, time),
    parts: VEHICLE_PARTS.map(part => ({ ...part, available: !part.market || marketOpen, stock: part.market ? Math.max(0, part.stock - Number(garage.market[part.market === 'daily' ? 'dayBought' : 'weekBought']?.[part.id] || 0)) : null })),
    models: VEHICLE_MODELS.filter(model => model.gallery !== false).map(model => ({ ...model, price: Math.floor(model.price * (garage.owned.includes('boya-kabini') && Number(garage.durability?.['boya-kabini'] ?? 100) > 0 ? 0.9 : 1)), unlocked: rank.level >= model.level })),
    mods: VEHICLE_MODS.map(mod => ({ ...mod, unlocked: rank.level >= mod.level, successChance: modSuccessChance(player, mod) })),
    boxes: VEHICLE_BOXES,
    capacity: rank.capacity, occupied: garage.vehicles.length,
    nextJobsAt: Date.parse(`${dateKey(time + 86_400_000)}T00:00:00+03:00`),
    junkyardReadyAt: garage.junkyardReadyAt, marketOpen,
    recentJob: garage.repairJobs.recent || null,
  };
}

export function vehicleAction(player, guildId, playerId, action, choice, { time, roll }) {
  const garage = normalizeVehicles(player, time), rank = garageLevel(garage.xp);
  if (action === 'partBuy') {
    const part = VEHICLE_PARTS.find(item => item.id === choice);
    requireRpg(part, 'Bu yedek parça bulunamadı.');
    if (part.market) {
      requireRpg(world(time, guildId).marketOpen, 'Nadir parça tüccarı şu anda kapalı.');
      const bucket = part.market === 'daily' ? garage.market.dayBought : garage.market.weekBought;
      requireRpg(Number(bucket[part.id] || 0) < part.stock, 'Bu parçanın dönemlik stoğu tükendi.');
      bucket[part.id] = Number(bucket[part.id] || 0) + 1;
    }
    requireRpg(player.coins >= part.price, 'Yedek parça için PitCoin bakiyen yetersiz.');
    requireRpg(Number(garage.depot[part.id] || 0) < 999, 'Bu parçadan depoda en fazla 999 adet tutulabilir.');
    player.coins -= part.price; garage.depot[part.id] = Number(garage.depot[part.id] || 0) + 1;
    return `${part.name} depoya eklendi. -${part.price} PitCoin.`;
  }
  if (action === 'boxBuy') {
    const box = VEHICLE_BOXES.find(item => item.id === choice);
    requireRpg(box, 'Bu modifiye kutusu bulunamadı.');
    requireRpg(player.coins >= box.price, 'Modifiye kutusu için PitCoin bakiyen yetersiz.');
    player.coins -= box.price;
    const rarity = box.maxRarity > box.minRarity && roll(1, 101) <= 22 ? box.maxRarity : box.minRarity;
    const pool = VEHICLE_PARTS.filter(item => item.rarity === rarity);
    const part = pool[roll(0, pool.length)];
    requireRpg(Number(garage.depot[part.id] || 0) < 999, 'Parça depon dolu.');
    garage.depot[part.id] = Number(garage.depot[part.id] || 0) + 1;
    return `${box.name} açıldı: ${part.name} çıktı. -${box.price} PitCoin.`;
  }
  if (action === 'junkyardSearch') {
    requireRpg(garage.junkyardReadyAt <= time, `Hurdalığa tekrar gitmek için ${Math.ceil((garage.junkyardReadyAt - time) / 60_000)} dakika bekle.`);
    requireRpg(player.coins >= 160, 'Hurdalık araması için 160 PitCoin gerekli.');
    player.coins -= 160; garage.junkyardReadyAt = time + 45 * 60_000;
    const foundCar = roll(1, 101) <= 25 && (rank.capacity == null || garage.vehicles.length < rank.capacity);
    if (foundCar) {
      const model = rank.level >= 2 ? VEHICLE_MODELS.find(item => item.id === 'classic') : VEHICLE_MODELS[0];
      garage.vehicles.push({ id: randomUUID(), modelId: model.id, status: 'broken', source: 'junkyard', foundAt: time, paid: 160, mods: [] });
      return `Hurdalıkta ${model.name} buldun! Garajına çekildi; tamir edebilir veya parçalarına ayırabilirsin.`;
    }
    const pool = VEHICLE_PARTS.filter(part => !part.market && part.rarity <= (rank.level >= 5 ? 3 : 2));
    const part = pool[roll(0, pool.length)];
    requireRpg(Number(garage.depot[part.id] || 0) < 999, 'Parça depon dolu.');
    garage.depot[part.id] = Number(garage.depot[part.id] || 0) + 1;
    return `Hurdalıkta araç bulamadın, fakat ${part.name} depoya eklendi.`;
  }
  if (action === 'jobRepair') {
    const job = dailyRepairJobs(guildId, playerId, player, time).find(item => item.id === choice);
    requireRpg(job, 'Bu günlük tamir işi bulunamadı veya süresi doldu.');
    requireRpg(!job.completed, 'Bu müşteri aracı zaten tamir edildi.');
    requireRpg(job.ready, 'Bu aracı tamir etmek için depodaki parçalar yetersiz.');
    consumeParts(garage.depot, job.parts);
    garage.repairJobs.completed.push(Number(choice.split(':')[1]));
    garage.repairJobs.recent = { modelId: job.modelId, completedAt: time };
    credit(player, job.reward, 0);
    garage.xp += job.xp;
    return `${job.name} tamir edildi. +${job.reward} PitCoin · +${job.xp} Garaj XP.`;
  }
  if (action === 'carBuy') {
    const model = VEHICLE_MODELS.find(item => item.id === choice);
    requireRpg(model && model.gallery !== false && model.price > 0, 'Bu araç galeride bulunamadı.');
    requireRpg(rank.level >= model.level, `Bu araç için Garaj Seviye ${model.level} gerekli.`);
    requireRpg(rank.capacity == null || garage.vehicles.length < rank.capacity, 'Garajında boş araç yeri yok.');
    const price = Math.floor(model.price * (garage.owned.includes('boya-kabini') && Number(garage.durability?.['boya-kabini'] ?? 100) > 0 ? 0.9 : 1));
    requireRpg(player.coins >= price, 'Bu araç için PitCoin bakiyen yetersiz.');
    player.coins -= price;
    if (garage.owned.includes('boya-kabini') && Number(garage.durability?.['boya-kabini'] ?? 100) > 0) garage.durability['boya-kabini']--;
    garage.vehicles.push({ id: randomUUID(), modelId: model.id, status: 'broken', boughtAt: time, paid: price, mods: [] });
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
  if (action === 'carSalvage') {
    const car = garage.vehicles.find(item => item.id === choice), model = VEHICLE_MODELS.find(item => item.id === car?.modelId);
    requireRpg(car && model, 'Bu araç garajında bulunamadı.');
    requireRpg(car.status === 'broken', 'Yalnızca bozuk araçlar parçalarına ayrılabilir.');
    for (const [id, count] of Object.entries(model.parts)) requireRpg(Number(garage.depot[id] || 0) + count <= 999, 'Parça depon dolu.');
    for (const [id, count] of Object.entries(model.parts)) garage.depot[id] = Number(garage.depot[id] || 0) + count;
    garage.vehicles = garage.vehicles.filter(item => item.id !== choice);
    return `${model.name} parçalarına ayrıldı. ${Object.entries(model.parts).map(([id, count]) => `${count} ${partById(id).name}`).join(', ')} depoya eklendi.`;
  }
  if (action === 'modApply') {
    const car = garage.vehicles.find(item => item.id === choice?.carId), model = VEHICLE_MODELS.find(item => item.id === car?.modelId);
    const mod = modById(choice?.modId);
    requireRpg(car && model && mod, 'Araç veya modifiye bulunamadı.');
    requireRpg(car.status === 'repaired', 'Modifiye için araç önce tamir edilmeli.');
    requireRpg(rank.level >= mod.level, `Bu modifiye için Garaj Seviye ${mod.level} gerekli.`);
    car.mods = Array.isArray(car.mods) ? car.mods : [];
    requireRpg(!car.mods.includes(mod.id), 'Bu modifiye araçta zaten takılı.');
    requireRpg(Number(garage.depot[mod.part] || 0) >= 1, `${partById(mod.part).name} parçası depoda yok.`);
    requireRpg(player.coins >= mod.fee, 'Modifiye işçiliği için PitCoin bakiyen yetersiz.');
    const chance = modSuccessChance(player, mod);
    player.coins -= mod.fee; garage.depot[mod.part]--;
    if (garage.equipped?.diagnostic && Number(garage.durability?.[garage.equipped.diagnostic] ?? 100) > 0) garage.durability[garage.equipped.diagnostic] = Math.max(0, Number(garage.durability[garage.equipped.diagnostic] ?? 100) - 1);
    if (roll(1, 101) > chance) return `${mod.name} kurulumu başarısız oldu. Parça ve ${mod.fee} PitCoin işçilik harcandı. Başarı şansı %${chance}.`;
    car.mods = car.mods.filter(id => modById(id)?.slot !== mod.slot); car.mods.push(mod.id);
    garage.xp += 20;
    return `${model.name}: ${mod.name} kuruldu. +${mod.race} yarış puanı · +${mod.value} araç değeri · +20 Garaj XP.`;
  }
  throw new Error('Geçersiz araç işlemi.');
}

export function auctionOpeningPrice(player, model, car = null) {
  const garage = player.garage;
  const active = id => garage.owned.includes(id) && Number(garage.durability?.[id] ?? 100) > 0;
  const bonus = (active('yikama-alani') ? 5 : 0) + (active('boya-kabini') ? 10 : 0);
  return Math.floor((model.value + (car ? carStats(car, model).modValue : 0)) * (1 + bonus / 100));
}
