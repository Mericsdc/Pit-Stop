import { createHash } from 'node:crypto';

export const ITEMS = Object.freeze([
  { id: 'demir-kilic', name: 'Demir kılıç', slot: 'sword', tier: 1, bonus: 2, price: 250 },
  { id: 'celik-kilic', name: 'Çelik kılıç', slot: 'sword', tier: 2, bonus: 4, price: 800 },
  { id: 'efsane-kilic', name: 'Efsanevi kılıç', slot: 'sword', tier: 3, bonus: 7, price: 2200 },
  { id: 'deri-zirh', name: 'Deri zırh', slot: 'armor', tier: 1, bonus: 1, price: 200 },
  { id: 'celik-zirh', name: 'Çelik zırh', slot: 'armor', tier: 2, bonus: 3, price: 650 },
  { id: 'efsane-zirh', name: 'Efsanevi zırh', slot: 'armor', tier: 3, bonus: 5, price: 1800 },
  { id: 'demir-kazma', name: 'Demir kazma', slot: 'pickaxe', tier: 1, bonus: 15, price: 500 },
  { id: 'elmas-kazma', name: 'Elmas kazma', slot: 'pickaxe', tier: 2, bonus: 35, price: 1600 },
  { id: 'demir-balta', name: 'Demir balta', slot: 'axe', tier: 1, bonus: 15, price: 450 },
  { id: 'celik-balta', name: 'Çelik balta', slot: 'axe', tier: 2, bonus: 30, price: 1400 },
  { id: 'can-iksiri', name: 'Can iksiri', slot: 'potion', tier: 1, bonus: 50, price: 80 },
  { id: 'sans-iksiri', name: 'Şans iksiri', slot: 'potion', tier: 2, bonus: 20, price: 150 },
  { id: 'lanetli-kilic', name: 'Lanetli kılıç', slot: 'sword', tier: 4, bonus: 14, price: 5000, source: 'blackmarket', cursed: true },
  { id: 'golge-zirh', name: 'Gölge zırhı', slot: 'armor', tier: 4, bonus: 8, price: 4500, source: 'blackmarket' },
  { id: 'ejder-kilic', name: 'Ejderha kılıcı', slot: 'sword', tier: 5, bonus: 12, source: 'craft' },
  { id: 'ejder-zirh', name: 'Ejderha zırhı', slot: 'armor', tier: 5, bonus: 10, source: 'craft' },
  { id: 'boss-kilic', name: 'Zindan hükümdarının kılıcı', slot: 'sword', tier: 4, bonus: 11, source: 'dungeon' },
]);
export const CLASSES = Object.freeze([
  { id: 'savasci', name: 'Savaşçı', bonus: 3, skill: 'öfke', description: '+3 savaş gücü; Öfke ile ek +7 güç.' },
  { id: 'buyucu', name: 'Büyücü', bonus: 2, skill: 'ateş-topu', description: '+2 savaş gücü; Ateş topu ile ek +9 güç.' },
  { id: 'okcu', name: 'Okçu', bonus: 2, skill: 'nişan', description: '+2 savaş gücü, madende +5 puan nadir bulma şansı; Nişan ile ek +8 güç.' },
]);
export const MONSTERS = Object.freeze([
  { id: 'goblin', name: 'Goblin', defense: 3, reward: 100, xp: 40 },
  { id: 'trol', name: 'Mağara trolü', defense: 8, reward: 200, xp: 80 },
  { id: 'ejderha', name: 'Garaj ejderhası', defense: 15, reward: 400, xp: 160 },
]);
export const RECIPES = Object.freeze([
  { id: 'ejder-kilic', name: 'Ejderha kılıcı', materials: { iron: 30, crystal: 8, fragment: 3 }, gold: 1000 },
  { id: 'ejder-zirh', name: 'Ejderha zırhı', materials: { iron: 25, wood: 15, fragment: 3 }, gold: 900 },
  { id: 'can-iksiri', name: 'Can iksiri', materials: { wood: 3, crystal: 1 }, gold: 20 },
  { id: 'sans-iksiri', name: 'Şans iksiri', materials: { crystal: 3, fragment: 1 }, gold: 40 },
]);
export const MATERIAL_NAMES = { iron: 'Demir', wood: 'Odun', crystal: 'Kristal', fragment: 'Boss parçası' };
export const QUESTS = Object.freeze([
  { id: 'goblin', name: '3 Goblin yen', field: 'goblins', target: 3, gold: 150, xp: 50 },
  { id: 'altin', name: 'Çalışma, maden veya savaşlarla 500 altın kazan', field: 'earned', target: 500, gold: 200, xp: 60 },
]);
export const LIMIT = 1_000_000_000;
export const DAY = 86_400_000;
export const level = xp => Math.floor(Math.sqrt(xp / 100)) + 1;
export const itemById = id => ITEMS.find(item => item.id === id);
export const dateKey = time => new Date(time + 3 * 3600_000).toISOString().slice(0, 10);
export class RpgError extends Error {}
export function requireRpg(condition, message) { if (!condition) throw new RpgError(message); }
export function world(time, guildId = '') {
  const day = dateKey(time), hour = new Date(time + 3 * 3600_000).getUTCHours();
  const seed = createHash('sha256').update(`${guildId}:${day}`).digest().readUInt32BE(0);
  const weather = ['Açık', 'Yağmurlu', 'Meteor yağmuru'][seed % 3];
  const openHours = [seed % 12, 12 + (seed >>> 8) % 12];
  return { date: day, hour, timezone: 'Europe/Istanbul', night: hour < 6 || hour >= 20, weather, openHours, marketOpen: openHours.includes(hour) };
}
export function normalize(saved, name, time) {
  const p = { name, coins: 0, xp: 0, wins: 0, losses: 0, sword: null, armor: null, inventory: [], cooldowns: {}, receipts: [], classId: null, hp: 100, regenAt: time, bag: {}, materials: {}, daily: {}, pvpWins: 0, pvpLosses: 0, ...saved };
  p.name = name || p.name;
  const ticks = Math.max(0, Math.floor((time - p.regenAt) / 1800_000));
  p.hp = Math.min(100, p.hp + ticks * 10);
  if (ticks) p.regenAt += ticks * 1800_000;
  if (p.quest?.date !== dateKey(time)) p.quest = { date: dateKey(time), earned: 0, goblins: 0, claimed: [] };
  if (p.fight?.expiresAt <= time) p.fight = null;
  return p;
}
export function credit(p, gold, xp = 0, quest = true) {
  requireRpg(Number.isSafeInteger(gold) && Number.isSafeInteger(xp) && p.coins + gold <= LIMIT && p.xp + xp <= LIMIT, 'Bakiye veya XP sınırına ulaşıldı.');
  p.coins += gold; p.xp += xp;
  if (quest && gold > 0) p.quest.earned += gold;
}
export function giveItem(p, id) {
  const item = itemById(id);
  requireRpg(item, 'Eşya bulunamadı.');
  if (item.slot === 'potion') {
    requireRpg((p.bag[id] || 0) < 999, 'Bu iksirden en fazla 999 adet taşıyabilirsin.');
    p.bag[id] = (p.bag[id] || 0) + 1;
  } else {
    requireRpg(!p.inventory.includes(id), 'Bu eşya zaten envanterinde.');
    p.inventory.push(id);
    if ((itemById(p[item.slot])?.tier || 0) < item.tier) p[item.slot] = id;
  }
}
export function power(p) {
  return (itemById(p.sword)?.bonus || 0) + (itemById(p.armor)?.bonus || 0)
    + Math.min(10, level(p.xp) - 1) + (CLASSES.find(c => c.id === p.classId)?.bonus || 0);
}
export function usePotion(p, id, time) {
  requireRpg((p.bag[id] || 0) > 0, 'Bu iksir envanterinde yok. /market ile alabilirsin.');
  if (id === 'can-iksiri') {
    requireRpg(p.hp < 100, 'Canın zaten dolu.'); p.hp = Math.min(100, p.hp + 50);
  } else {
    requireRpg(id === 'sans-iksiri', 'Geçersiz iksir.');
    requireRpg(!(p.luckUntil > time), 'Şans iksirin zaten etkin.'); p.luckUntil = time + 1800_000;
  }
  p.bag[id]--;
}

// Called only inside a synchronous database transaction. A thrown error rolls everything back.
export function advancedAction(p, action, choice, { time, roll, guildId, interactionId }) {
  const w = world(time, guildId);
  if (action === 'class') {
    requireRpg(level(p.xp) >= 10, 'Sınıf seçmek için Seviye 10 olmalısın.');
    requireRpg(!p.classId, 'Sınıfın zaten seçilmiş. Sınıf seçimi kalıcıdır.');
    const c = CLASSES.find(c => c.id === choice); requireRpg(c, 'Geçerli bir sınıf seç.');
    p.classId = c.id; return `Sınıfın: **${c.name}**. ${c.description} /${c.skill} canavar:... ile yeteneğini kullan.`;
  }
  if (action === 'daily') {
    requireRpg(!p.daily.lastAt || time - p.daily.lastAt >= DAY, `Günlük ödül için ${Math.max(1, Math.ceil((DAY - (time - (p.daily.lastAt || 0))) / 3600_000))} saat daha beklemelisin.`);
    const streak = p.daily.lastAt && time - p.daily.lastAt <= 2 * DAY ? Math.min(7, (p.daily.streak || 0) + 1) : 1;
    const gold = 100 + (streak - 1) * 25, xp = 25 + (streak - 1) * 5;
    credit(p, gold, xp, false); p.daily = { lastAt: time, streak };
    return `Günlük ödül: **+${gold} altın · +${xp} XP**. Seri: **${streak}/7**. 24 saat sonra yeniden alabilirsin; 48 saat aşılırsa seri sıfırlanır.`;
  }
  if (action === 'quest') {
    const q = QUESTS.find(q => q.id === choice); requireRpg(q, 'Geçerli bir görev seç.');
    requireRpg(!p.quest.claimed.includes(q.id), 'Bu görevin ödülünü bugün aldın.');
    requireRpg(p.quest[q.field] >= q.target, 'Görev henüz tamamlanmadı.');
    credit(p, q.gold, q.xp, false); p.quest.claimed.push(q.id);
    return `Görev tamamlandı: **${q.name}** · +${q.gold} altın · +${q.xp} XP.`;
  }
  if (action === 'craft') {
    const recipe = RECIPES.find(r => r.id === choice); requireRpg(recipe, 'Geçerli bir tarif seç.');
    requireRpg(p.coins >= recipe.gold, 'Üretim için altının yetmiyor.');
    for (const [id, amount] of Object.entries(recipe.materials)) requireRpg((p.materials[id] || 0) >= amount, `${MATERIAL_NAMES[id]} yetersiz: ${amount} gerekli.`);
    giveItem(p, recipe.id); p.coins -= recipe.gold;
    for (const [id, amount] of Object.entries(recipe.materials)) p.materials[id] -= amount;
    if (itemById(recipe.id).source === 'craft') p.achievement = { id: interactionId, text: `${recipe.name} üretti!` };
    return `**${recipe.name}** ürettin. ${recipe.gold} altın ve tarif malzemeleri kullanıldı.`;
  }
  if (action === 'potion') { requireRpg(!p.fight, 'Zindandayken İksir İç düğmesini kullan.'); usePotion(p, choice, time); return `İksir kullanıldı. Can: **${p.hp}/100**.${choice === 'sans-iksiri' ? ' 30 dakika boyunca madende ve zindanda nadir eşya şansı +20 puan.' : ''}`; }
  if (action === 'gamble') {
    requireRpg(Number.isSafeInteger(choice) && choice >= 10 && choice <= 500, 'Bahis 10–500 sanal altın olmalı.');
    requireRpg(p.coins >= choice, 'Altının yetmiyor.');
    const die = roll(1, 7); p.coins -= choice;
    if (die >= 5) credit(p, choice * 2, 0, false);
    return `🎲 Zar: **${die}**. ${die >= 5 ? `Kazandın! Net +${choice} altın.` : `${choice} altın kaybettin.`} Bakiye: **${p.coins}**.\n5–6 kazanır (olasılık 1/3); 1–4 kaybeder. Yalnızca sanal altın; gerçek para değeri yoktur.`;
  }
  if (action === 'dungeon') {
    requireRpg(level(p.xp) >= 3, 'Zindan için Seviye 3 gerekli.');
    requireRpg(!p.fight, 'Zaten bir zindandasın. /zindan ile devam et.');
    requireRpg(p.hp >= 20, 'Zindana girmek için en az 20 can gerekli. /iksir kullan veya dinlen.');
    p.fight = { id: interactionId, hp: 100, turn: 0, expiresAt: time + 15 * 60_000 };
    return 'Zindan hükümdarı karşında! Boss: **100 can**. Saldır, iksir iç veya kaç. Savaş 15 dakika / en fazla 20 tur sürer.';
  }
  if (action === 'dungeonTurn') {
    const f = p.fight;
    requireRpg(f && f.id === choice.id && f.turn === choice.turn, 'Bu savaş düğmesi eskimiş. /zindan ile güncel savaşı aç.');
    if (choice.move === 'flee') { p.fight = null; return 'Zindandan kaçtın. Ekipmanın ve altının sende kaldı; giriş bekleme süresi devam ediyor.'; }
    requireRpg(['attack','heal'].includes(choice.move), 'Geçersiz savaş hamlesi.');
    let damage = 0;
    if (choice.move === 'heal') usePotion(p, 'can-iksiri', time);
    else { damage = roll(1, 21) + power(p); if (itemById(p.sword)?.cursed && roll(1, 101) <= 25) damage = Math.max(1, damage - 10); f.hp = Math.max(0, f.hp - damage); }
    f.turn++;
    if (!f.hp) {
      credit(p, 600, 250); p.wins++; p.materials.fragment = (p.materials.fragment || 0) + 1;
      const drop = roll(1, 101) <= 25 + (p.luckUntil > time ? 20 : 0);
      let loot = '1 boss parçası';
      if (drop && !p.inventory.includes('boss-kilic')) { giveItem(p, 'boss-kilic'); loot += ' ve Zindan hükümdarının kılıcı'; }
      else if (drop) { p.materials.fragment++; loot += ' ve 1 ek boss parçası (kılıç zaten sende)'; }
      p.fight = null; p.achievement = { id: interactionId, text: `Zindan hükümdarını yendi! +600 altın, +250 XP; ${loot}.` };
      return `🏆 Boss yenildi! **+600 altın · +250 XP**. Ganimet: **${loot}**.`;
    }
    const hit = Math.max(2, roll(1, 21) + 8 - (itemById(p.armor)?.bonus || 0));
    p.hp = Math.max(0, p.hp - hit);
    if (!p.hp || f.turn >= 20) { p.losses++; p.fight = null; return 'Zindan sona erdi. Canın tükendi veya 20 tur doldu. Eşyan kaybolmaz; canın her 30 dakikada 10 yenilenir.'; }
    return `Tur ${f.turn}: ${choice.move === 'heal' ? 'İksir içtin' : `${damage} hasar verdin`}; boss ${hit} hasar verdi.\nSen: **${p.hp}/100** · Boss: **${f.hp}/100**`;
  }
  throw new RpgError('Geçersiz RPG işlemi.');
}
