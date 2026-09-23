const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const GARAGE_LEVELS = Object.freeze([
  { level: 1, xp: 0, name: 'Sokak Kenarı', capacity: 1, incomeBonus: 0 },
  { level: 2, xp: 250, name: 'Kiralık Tekli Depo', capacity: 2, incomeBonus: 0 },
  { level: 3, xp: 700, name: 'Amatör Atölye', capacity: 3, incomeBonus: 5 },
  { level: 4, xp: 1_400, name: 'Mahalle Tamircisi', capacity: 4, incomeBonus: 5 },
  { level: 5, xp: 2_400, name: 'Yerel Garaj', capacity: 5, incomeBonus: 10 },
  { level: 6, xp: 3_800, name: 'Özel Modifiye Merkezi', capacity: 6, incomeBonus: 10 },
  { level: 7, xp: 5_600, name: 'Performans Atölyesi', capacity: 8, incomeBonus: 10 },
  { level: 8, xp: 7_900, name: 'Profesyonel Tesis', capacity: 10, incomeBonus: 15 },
  { level: 9, xp: 10_800, name: 'Elit Motor Sporları Merkezi', capacity: 15, incomeBonus: 15 },
  { level: 10, xp: 14_500, name: 'Pit-Stop Garage', capacity: null, incomeBonus: 25 },
]);

export const GARAGE_UPGRADES = Object.freeze([
  { id: 'pasli-aletler', category: 'tools', name: 'Paslı Alet Çantası', level: 1, price: 0, incomeBonus: 0, symbol: '🧰', description: 'Başlangıç el aletleri.' },
  { id: 'krom-set', category: 'tools', name: 'Krom 120 Parça Set', level: 2, price: 800, incomeBonus: 10, symbol: '🧰', description: 'Vardiya gelirini %10 artırır.' },
  { id: 'titanyum-set', category: 'tools', name: 'Havalı Somun Tabancası ve Titanyum Set', level: 5, price: 3_000, incomeBonus: 25, symbol: '🔧', description: 'Vardiya gelirini %25 artırır.' },
  { id: 'master-set', category: 'tools', name: 'Pit-Stop Master Seri Takım', level: 9, price: 9_000, incomeBonus: 40, symbol: '🛠️', description: 'Vardiya gelirini %40 artırır.' },
  { id: 'timsah-kriko', category: 'lift', name: 'Timsah Kriko', level: 1, price: 0, cooldownMinutes: 0, symbol: '⬆️', description: 'Standart vardiya süresi.' },
  { id: 'makasli-lift', category: 'lift', name: 'Manuel Makaslı Lift', level: 3, price: 1_200, cooldownMinutes: 5, symbol: '🏗️', description: 'Vardiya süresini 5 dakika azaltır.' },
  { id: 'hidrolik-lift', category: 'lift', name: 'Çift Sütunlu Hidrolik Lift', level: 5, price: 4_500, cooldownMinutes: 10, doubleChance: 20, symbol: '🏗️', description: 'Süreyi 10 dakika azaltır; %20 çifte vardiya şansı verir.' },
  { id: 'obd2', category: 'diagnostic', name: 'Ucuz Bluetooth OBD2', level: 4, price: 1_600, xpBonus: 5, symbol: '📟', description: 'Garaj XP kazancını %5 artırır.' },
  { id: 'tespit-tableti', category: 'diagnostic', name: 'Profesyonel Arıza Tespit Tableti', level: 6, price: 4_200, xpBonus: 10, symbol: '📱', description: 'Garaj XP kazancını %10 artırır ve işlem riskini azaltır.' },
  { id: 'dyno', category: 'diagnostic', name: 'Dinamometre Test Cihazı', level: 7, price: 7_000, xpBonus: 15, successChance: 100, symbol: '📈', description: 'Garaj XP kazancını %15 artırır; modifiye başarı şansı %100 olur.' },
  { id: 'yikama-alani', category: 'facility', name: 'Basınçlı Yıkama Alanı', level: 4, price: 2_200, saleBonus: 5, symbol: '🚿', description: 'Araç satış değerini %5 artırır.' },
  { id: 'boya-kabini', category: 'facility', name: 'Özel Fırınlı Boya Kabini', level: 6, price: 6_500, tradeBonus: 10, symbol: '🎨', description: 'Araç alım satımında %10 avantaj sağlar.' },
  { id: 'ikinci-el-cekici', category: 'tow', name: 'İkinci El Çekici Kamyonet', level: 4, price: 2_000, risk: 15, symbol: '🚚', description: 'Yol yardım görevlerini açar; kaza riski %15.' },
  { id: 'kayar-kasa-cekici', category: 'tow', name: 'Hidrolik Kayar Kasa Çekici', level: 6, price: 6_500, risk: 5, symbol: '🚛', description: 'Yol yardımı kaza riskini %5’e düşürür.' },
  { id: 'ahtapot-kurtarici', category: 'tow', name: 'Ağır Vasıta Ahtapot Kurtarıcı', level: 8, price: 15_000, risk: 0, symbol: '🚛', description: 'Kaza riskini kaldırır ve VIP görevlerini açar.' },
  { id: 'pasli-yedek', category: 'employeeTools', name: 'Paslı Yedek Takım', level: 5, employeeLevel: 1, price: 0, employeeActiveBonus: 0, symbol: '🧰', description: 'Çırağın başlangıç aletleri.' },
  { id: 'stajyer-takim', category: 'employeeTools', name: 'Stajyer Takım Çantası', level: 5, employeeLevel: 1, price: 700, employeeActiveBonus: 2, symbol: '🧰', description: 'Çalışan vardiya desteğine +%2 ekler.' },
  { id: 'kalfa-krom', category: 'employeeTools', name: 'Kalfanın Krom Seti', level: 5, employeeLevel: 2, price: 1_800, employeeActiveBonus: 5, symbol: '🧰', description: 'Çalışan vardiya desteğine +%5 ekler.' },
  { id: 'usta-seti', category: 'employeeTools', name: 'Usta İşçiliği Seti', level: 6, employeeLevel: 3, price: 4_000, employeeActiveBonus: 10, symbol: '🔧', description: 'Çalışan vardiya desteğine +%10 ekler.' },
  { id: 'sef-seti', category: 'employeeTools', name: 'Pit-Stop Personel Şefi Seti', level: 8, employeeLevel: 4, price: 8_000, employeeActiveBonus: 15, symbol: '🛠️', description: 'Şef Mekanik vardiya desteğine +%15 ekler.' },
  { id: 'palet-kriko', category: 'employeeStation', name: 'Palet Üstü Kriko', level: 5, employeeLevel: 1, price: 0, passiveBonus: 0, symbol: '🔩', description: 'Çırağın başlangıç çalışma istasyonu.' },
  { id: 'seyyar-yukseltici', category: 'employeeStation', name: 'Seyyar Yükseltici', level: 5, employeeLevel: 1, price: 900, passiveBonus: 5, symbol: '🔩', description: 'Çalışanın saatlik üretimine +5 PitCoin.' },
  { id: 'tek-sutun-lift', category: 'employeeStation', name: 'Sabit Tek Sütunlu Lift', level: 5, employeeLevel: 2, price: 2_400, passiveBonus: 15, symbol: '🏗️', description: 'Saatlik üretime +15 PitCoin.' },
  { id: 'personel-hidrolik', category: 'employeeStation', name: 'Çalışana Özel Hidrolik Lift', level: 6, employeeLevel: 3, price: 5_000, passiveBonus: 30, symbol: '🏗️', description: 'Saatlik üretime +30 PitCoin.' },
  { id: 'sef-atolyesi', category: 'employeeStation', name: 'Şefin Bağımsız Atölyesi', level: 9, employeeLevel: 4, price: 11_000, passiveBonus: 60, autoWorkBonus: 50, symbol: '🏭', description: 'Saatlik üretime +60; otomatik mesaiyi %50 artırır.' },
]);

const EMPLOYEE_LEVELS = Object.freeze([
  { level: 1, xp: 0, name: 'Çırak', hourly: 10, activeBonus: 5 },
  { level: 2, xp: 250, name: 'Kalfa', hourly: 25, activeBonus: 10 },
  { level: 3, xp: 700, name: 'Usta', hourly: 50, activeBonus: 15 },
  { level: 4, xp: 1_500, name: 'Şef Mekanik', hourly: 100, activeBonus: 25 },
]);

const byId = id => GARAGE_UPGRADES.find(item => item.id === id);
const installUpgrade = (garage, item) => {
  if (!garage.owned.includes(item.id)) garage.owned.push(item.id);
  garage.durability[item.id] ??= 100;
  if (item.category !== 'facility') garage.equipped[item.category] = item.id;
};
export const garageLevel = xp => [...GARAGE_LEVELS].reverse().find(item => Number(xp || 0) >= item.xp) || GARAGE_LEVELS[0];
const employeeLevel = xp => [...EMPLOYEE_LEVELS].reverse().find(item => Number(xp || 0) >= item.xp) || EMPLOYEE_LEVELS[0];

export function normalizeGarage(player, time) {
  const saved = player.garage && typeof player.garage === 'object' ? player.garage : {};
  const garage = {
    xp: 0, shifts: 0, owned: ['pasli-aletler', 'timsah-kriko'],
    equipped: { tools: 'pasli-aletler', lift: 'timsah-kriko', diagnostic: null, tow: null, employeeTools: null, employeeStation: null },
    employee: null, roadsideCooldown: 0, nextFastShifts: 0, ...saved,
  };
  garage.owned = [...new Set(['pasli-aletler', 'timsah-kriko', ...(Array.isArray(garage.owned) ? garage.owned : [])])].filter(id => byId(id));
  garage.equipped = { tools: 'pasli-aletler', lift: 'timsah-kriko', diagnostic: null, tow: null, employeeTools: null, employeeStation: null, ...(garage.equipped || {}) };
  garage.durability = garage.durability && typeof garage.durability === 'object' ? garage.durability : {};
  for (const id of garage.owned) garage.durability[id] = Math.max(0, Math.min(100, Number(garage.durability[id] ?? 100)));
  garage.orders = Array.isArray(garage.orders) ? garage.orders.filter(order => byId(order?.id) && Number.isFinite(order?.readyAt)) : [];
  for (const order of garage.orders.filter(order => order.readyAt <= time)) installUpgrade(garage, byId(order.id));
  garage.orders = garage.orders.filter(order => order.readyAt > time);
  if (garage.employee) {
    garage.employee = {
      xp: 0, morale: 100, leaveUntil: null, leaveStartedAt: null, lastCollectedAt: time,
      durability: { tools: 100, station: 100 }, autoWorkAt: 0, ...garage.employee,
    };
    garage.employee.durability = { tools: 100, station: 100, ...(garage.employee.durability || {}) };
    garage.owned = [...new Set([...garage.owned, 'pasli-yedek', 'palet-kriko'])];
    garage.equipped.employeeTools ||= 'pasli-yedek';
    garage.equipped.employeeStation ||= 'palet-kriko';
    if (garage.employee.leaveUntil && garage.employee.leaveUntil <= time) {
      garage.employee.morale = 100; garage.employee.leaveUntil = null; garage.employee.leaveStartedAt = null; garage.employee.lastCollectedAt = time;
    }
  }
  player.garage = garage;
  return garage;
}

function moraleFactor(morale) {
  if (morale >= 70) return 1;
  if (morale >= 30) return .8;
  if (morale >= 10) return .5;
  return 0;
}

export function garageWorkDuration(player) {
  const garage = player.garage;
  const lift = byId(garage?.equipped?.lift);
  const fast = garage?.nextFastShifts > 0 ? 15 : 0;
  return Math.max(5, 30 - (Number(garage?.durability?.[lift?.id] ?? 100) > 0 ? Number(lift?.cooldownMinutes || 0) : 0) - fast) * 60_000;
}

export function resolveGarageShift(player, { time, roll, baseGold, baseXp }) {
  const garage = normalizeGarage(player, time), levelInfo = garageLevel(garage.xp);
  const tools = byId(garage.equipped.tools), lift = byId(garage.equipped.lift), diagnostic = byId(garage.equipped.diagnostic);
  let employeeBonus = 0, employeeNote = '';
  if (garage.employee && !garage.employee.leaveUntil) {
    const rank = employeeLevel(garage.employee.xp), kit = garage.employee.durability.tools > 0 ? byId(garage.equipped.employeeTools) : null;
    employeeBonus = Math.round((rank.activeBonus + Number(kit?.employeeActiveBonus || 0)) * moraleFactor(garage.employee.morale));
    garage.employee.xp = Math.min(1_000_000_000, garage.employee.xp + 18);
    const moraleLoss = garage.employee.durability.tools <= 0 || garage.employee.durability.station <= 0 ? 4 : 2;
    garage.employee.morale = Math.max(0, garage.employee.morale - moraleLoss);
    const durabilityLoss = rank.level >= 3 && garage.shifts % 2 === 0 ? 0 : 1;
    garage.employee.durability.tools = Math.max(0, garage.employee.durability.tools - durabilityLoss);
    garage.employee.durability.station = Math.max(0, garage.employee.durability.station - durabilityLoss);
    employeeNote = `${rank.name} desteği +%${employeeBonus}`;
  }
  const workingTools = Number(garage.durability[tools?.id] ?? 100) > 0;
  const workingLift = Number(garage.durability[lift?.id] ?? 100) > 0;
  const workingDiagnostic = Number(garage.durability[diagnostic?.id] ?? 100) > 0;
  const percent = levelInfo.incomeBonus + (workingTools ? Number(tools?.incomeBonus || 0) : 0) + employeeBonus;
  let gold = Math.floor(baseGold * (1 + percent / 100)), xp = baseXp;
  const double = workingLift && Number(lift?.doubleChance || 0) && roll(1, 101) <= lift.doubleChance;
  if (double) { gold *= 2; xp *= 2; }
  const garageXp = Math.floor(45 * (1 + (workingDiagnostic ? Number(diagnostic?.xpBonus || 0) : 0) / 100));
  garage.xp = Math.min(1_000_000_000, garage.xp + garageXp);
  garage.shifts++;
  for (const id of [garage.equipped.tools, garage.equipped.lift, garage.equipped.diagnostic].filter(Boolean)) garage.durability[id] = Math.max(0, Number(garage.durability[id] ?? 100) - 1);
  if (garage.nextFastShifts > 0) garage.nextFastShifts--;
  let eventText = '', penalty = 0;
  if (roll(1, 101) <= 12) {
    const pool = roll(1, 101);
    if (pool <= 60) {
      const event = roll(0, 3);
      if (event === 0) { gold *= 3; eventText = '💰 Zengin Müşteri: vardiya geliri üçe katlandı.'; }
      else if (event === 1) { garage.xp += 150; eventText = '📦 Depo Temizliği: +150 Garaj XP.'; }
      else { garage.nextFastShifts = Math.max(garage.nextFastShifts, 3); eventText = '🔥 Mahalle Fuarı: sonraki 3 vardiya 15 dakika daha kısa.'; }
    } else if (pool <= 95) {
      const event = roll(0, 3);
      if (event === 0) { penalty = 150; eventText = '🛢️ İş Kazası: 150 PitCoin temizlik masrafı.'; }
      else if (event === 1) { penalty = 250; eventText = '🚨 Zabıta Denetimi: 250 PitCoin ceza.'; }
      else { gold = 0; xp = 0; eventText = '⚡ Elektrik Kesintisi: vardiya geliri ve karakter XP’si kaybedildi.'; }
    } else if (roll(0, 2) === 0) { penalty = 300; eventText = '🔫 Pit-Stop Baskını: PistolShow parça masrafını sana bıraktı. -300 PitCoin.'; }
    else { penalty = 100; eventText = '💻 Kontrol Merkezi Kazası: Lurexa sigortaları attırdı. -100 PitCoin.'; }
  }
  if (garage.employee && garage.employee.morale < 10 && roll(1, 101) <= 50) {
    penalty += 150; eventText += `${eventText ? ' ' : ''}🚨 Çalışan sabotajı: 150 PitCoin tamir masrafı.`;
  }
  return { gold, xp, garageXp, penalty: Math.min(player.coins + gold, penalty), double: Boolean(double), employeeNote, eventText, level: garageLevel(garage.xp) };
}

function employeePending(garage, time) {
  if (!garage.employee || garage.employee.leaveUntil) return { hours: 0, amount: 0 };
  const hours = Math.min(24, Math.max(0, Math.floor((time - Number(garage.employee.lastCollectedAt || time)) / HOUR)));
  const rank = employeeLevel(garage.employee.xp), station = garage.employee.durability.station > 0 ? byId(garage.equipped.employeeStation) : null;
  const amount = Math.floor(hours * (rank.hourly + Number(station?.passiveBonus || 0)) * moraleFactor(garage.employee.morale));
  return { hours, amount };
}

export function garageAction(player, action, choice, { time, roll }) {
  const garage = normalizeGarage(player, time), levelInfo = garageLevel(garage.xp);
  if (action === 'garageBuy') {
    const item = byId(choice);
    if (!item || !item.price) throw new Error('Geçerli bir garaj ekipmanı seç.');
    if (garage.owned.includes(item.id) || garage.orders.some(order => order.id === item.id)) throw new Error('Bu ekipman zaten garajında veya kargoda.');
    if (levelInfo.level < item.level) throw new Error(`Bu ekipman için Garaj Seviye ${item.level} gerekli.`);
    if (item.employeeLevel && !garage.employee) throw new Error('Önce bir çalışan işe almalısın.');
    if (item.employeeLevel && employeeLevel(garage.employee.xp).level < item.employeeLevel) throw new Error(`Bu ekipman için çalışan Seviye ${item.employeeLevel} gerekli.`);
    if (player.coins < item.price) throw new Error('Bu ekipman için PitCoin bakiyen yetersiz.');
    player.coins -= item.price;
    garage.orders.push({ id: item.id, orderedAt: time, readyAt: time + 15 * 60_000, price: item.price });
    return `${item.symbol} **${item.name}** sipariş edildi. 15 dakika sonra kurulacak. Bakiye: **${player.coins} PitCoin**.`;
  }
  if (action === 'garageExpedite') {
    const order = garage.orders.find(entry => entry.id === choice), item = byId(order?.id);
    if (!order || !item) throw new Error('Hızlandırılacak kargo bulunamadı.');
    const cost = Math.max(50, Math.ceil(order.price * .15));
    if (player.coins < cost) throw new Error(`Hızlı kurulum için ${cost} PitCoin gerekli.`);
    player.coins -= cost; installUpgrade(garage, item); garage.orders = garage.orders.filter(entry => entry.id !== choice);
    return `${item.name} ${cost} PitCoin karşılığında hemen kuruldu.`;
  }
  if (action === 'repairUpgrade') {
    const item = byId(choice);
    if (!item || !garage.owned.includes(item.id)) throw new Error('Bu ekipman garajında bulunmuyor.');
    const damage = 100 - Number(garage.durability[item.id] ?? 100), cost = Math.ceil(damage * 3);
    if (!damage) throw new Error('Bu ekipman zaten sağlam.');
    if (player.coins < cost) throw new Error(`Bakım için ${cost} PitCoin gerekli.`);
    player.coins -= cost; garage.durability[item.id] = 100;
    return `${item.name} bakımı tamamlandı. -${cost} PitCoin.`;
  }
  if (action === 'hireEmployee') {
    if (!garage.owned.includes('hidrolik-lift')) throw new Error('Çalışan almak için Çift Sütunlu Hidrolik Lift gerekli.');
    if (garage.employee) throw new Error('Garajında zaten bir çalışan var.');
    if (player.coins < 1_500) throw new Error('Çırak işe almak için 1.500 PitCoin gerekli.');
    player.coins -= 1_500;
    garage.employee = { xp: 0, morale: 100, leaveUntil: null, leaveStartedAt: null, lastCollectedAt: time, durability: { tools: 100, station: 100 }, autoWorkAt: 0 };
    garage.owned.push('pasli-yedek', 'palet-kriko'); garage.equipped.employeeTools = 'pasli-yedek'; garage.equipped.employeeStation = 'palet-kriko';
    return '👨‍🔧 Çırak işe alındı. Morali **100/100**; vardiyalarına +%5 destek sağlar.';
  }
  if (action === 'employeeBonus') {
    if (!garage.employee) throw new Error('Garajında çalışan bulunmuyor.');
    if (garage.employee.leaveUntil) throw new Error('Çalışanın şu anda izinde.');
    if (player.coins < 200) throw new Error('İkramiye için 200 PitCoin gerekli.');
    player.coins -= 200; garage.employee.morale = Math.min(100, garage.employee.morale + 50);
    return `🎁 200 PitCoin ikramiye verildi. Çalışan morali **${garage.employee.morale}/100**.`;
  }
  if (action === 'employeeLeave') {
    if (!garage.employee) throw new Error('Garajında çalışan bulunmuyor.');
    if (garage.employee.leaveUntil) throw new Error('Çalışanın zaten izinde.');
    garage.employee.leaveStartedAt = time; garage.employee.leaveUntil = time + DAY;
    return '🌴 Çalışan 24 saat izne ayrıldı. Dönüşte morali 100/100 olacak.';
  }
  if (action === 'employeeCollect') {
    if (!garage.employee) throw new Error('Garajında çalışan bulunmuyor.');
    const pending = employeePending(garage, time);
    if (!pending.hours) throw new Error('Toplanacak tamamlanmış pasif mesai yok.');
    player.coins += pending.amount; garage.employee.lastCollectedAt += pending.hours * HOUR;
    const moraleLoss = garage.employee.durability.tools <= 0 || garage.employee.durability.station <= 0 ? pending.hours * 2 : pending.hours;
    garage.employee.morale = Math.max(0, garage.employee.morale - moraleLoss);
    garage.employee.durability.tools = Math.max(0, garage.employee.durability.tools - Math.floor(pending.hours / 2));
    garage.employee.durability.station = Math.max(0, garage.employee.durability.station - Math.floor(pending.hours / 2));
    return `💼 ${pending.hours} saatlik personel mesaisi toplandı: **+${pending.amount} PitCoin**.`;
  }
  if (action === 'autoWork') {
    if (!garage.employee || employeeLevel(garage.employee.xp).level < 4) throw new Error('Otomatik mesai için Şef Mekanik gerekli.');
    if (garage.employee.leaveUntil) throw new Error('Çalışanın şu anda izinde.');
    if (garage.employee.autoWorkAt && time - garage.employee.autoWorkAt < DAY) throw new Error('Otomatik mesai günde yalnızca bir kez kullanılabilir.');
    const station = byId(garage.equipped.employeeStation), amount = Math.floor(600 * (1 + Number(station?.autoWorkBonus || 0) / 100) * moraleFactor(garage.employee.morale));
    if (!amount) throw new Error('Çalışan morali otomatik mesai için çok düşük.');
    player.coins += amount; garage.employee.autoWorkAt = time; garage.employee.morale = Math.max(0, garage.employee.morale - 10);
    return `⚙️ Otomatik mesai tamamlandı: **+${amount} PitCoin**.`;
  }
  if (action === 'repairEmployee') {
    if (!garage.employee) throw new Error('Garajında çalışan bulunmuyor.');
    const cost = (100 - garage.employee.durability.tools + 100 - garage.employee.durability.station) * 3;
    if (!cost) throw new Error('Çalışan ekipmanları zaten sağlam.');
    if (player.coins < cost) throw new Error(`Tamir için ${cost} PitCoin gerekli.`);
    player.coins -= cost; garage.employee.durability = { tools: 100, station: 100 };
    return `🔧 Çalışan ekipmanları **${cost} PitCoin** karşılığında tamamen onarıldı.`;
  }
  if (action === 'roadside') {
    const tow = byId(garage.equipped.tow);
    if (levelInfo.level < 4 || !tow) throw new Error('Yol yardımı için Garaj Seviye 4 ve bir çekici gerekli.');
    if (Number(garage.durability[tow.id] ?? 100) <= 0) throw new Error('Çekici aşındı. Önce ekipman bakımı yapmalısın.');
    if (garage.roadsideCooldown > time) throw new Error(`Çekici operasyonda. ${Math.ceil((garage.roadsideCooldown - time) / 60_000)} dakika beklemelisin.`);
    const die = roll(1, 101), risk = Number(tow.risk || 0); garage.roadsideCooldown = time + 30 * 60_000;
    garage.durability[tow.id] = Math.max(0, Number(garage.durability[tow.id] ?? 100) - 1);
    if (die <= risk) { const loss = Math.min(player.coins, 300); player.coins -= loss; return `💥 Kurtarma başarısız oldu. **-${loss} PitCoin** tamir masrafı; çekici 30 dakika arızalı.`; }
    if (die <= risk + 25) { player.coins += 150; return '🔧 Yerinde müdahale tamamlandı. **+150 PitCoin**.'; }
    const vip = tow.id === 'ahtapot-kurtarici' && roll(1, 101) <= 20, reward = vip ? 700 : 400, xp = vip ? 120 : 75;
    player.coins += reward; garage.xp += xp;
    return `🏆 ${vip ? 'VIP spor araç' : 'Araç'} başarıyla kurtarıldı. **+${reward} PitCoin · +${xp} Garaj XP**.`;
  }
  throw new Error('Geçersiz garaj işlemi.');
}

export function garageState(player, time) {
  const garage = normalizeGarage(player, time), current = garageLevel(garage.xp), next = GARAGE_LEVELS.find(item => item.level === current.level + 1) || null;
  const employee = garage.employee ? (() => {
    const rank = employeeLevel(garage.employee.xp), nextRank = EMPLOYEE_LEVELS.find(item => item.level === rank.level + 1) || null;
    return { ...garage.employee, level: rank.level, title: rank.name, hourly: rank.hourly, activeBonus: rank.activeBonus, nextXp: nextRank?.xp || null, pending: employeePending(garage, time), onLeave: Boolean(garage.employee.leaveUntil) };
  })() : null;
  return {
    xp: garage.xp, xpStart: current.xp, shifts: garage.shifts, level: current.level, name: current.name, capacity: current.capacity,
    incomeBonus: current.incomeBonus, nextXp: next?.xp || null, owned: garage.owned, equipped: garage.equipped,
    upgrades: GARAGE_UPGRADES.map(item => ({ ...item, owned: garage.owned.includes(item.id), equipped: garage.equipped[item.category] === item.id, durability: garage.durability[item.id] ?? null, readyAt: garage.orders.find(order => order.id === item.id)?.readyAt || null, unlocked: current.level >= item.level && (!item.employeeLevel || (employee && employee.level >= item.employeeLevel)) })),
    orders: garage.orders, durability: garage.durability,
    employee, roadsideReadyAt: garage.roadsideCooldown || 0, nextFastShifts: garage.nextFastShifts || 0,
    workMinutes: garageWorkDuration(player) / 60_000,
  };
}
