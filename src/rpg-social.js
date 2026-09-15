import { escapeMarkdown } from 'discord.js';
import { requireRpg, normalize, credit, giveItem, itemById, power } from './rpg-system.js';
const title = user => user.globalName || user.username;
export function createSocial(store, { now, roll, profile }) {
  function audit(guildId, actor, type, message, details) {
    try { store.addLog(guildId, { type, actorId: actor.id, message, details: { actorName: title(actor), ...details } }); }
    catch { /* A diagnostic failure must not retry a committed money transfer. */ }
  }
  function transfer(guildId, from, to, { gold, item }, id) {
    requireRpg(to && from.id !== to.id && !to.bot, 'Kendine veya botlara gönderemezsin.');
    requireRpg(Boolean(gold) !== Boolean(item), 'Yalnızca altın veya eşya seç; ikisini birlikte gönderemezsin.');
    requireRpg(!gold || (Number.isSafeInteger(gold) && gold >= 1 && gold <= 100000), 'Altın miktarı 1–100.000 olmalı.');
    store.transactRecords(guildId, [{ kind: 'rpg_player', id: from.id }, { kind: 'rpg_player', id: to.id }, { kind: 'rpg_transfer', id }], ([a, b, receipt]) => {
      requireRpg(!receipt, 'Bu transfer zaten tamamlandı.');
      const p = normalize(a, title(from), now()), q = normalize(b, title(to), now());
      requireRpg(!p.fight && !q.fight, 'Zindandaki oyuncular eşya veya altın aktaramaz.');
      if (gold) { requireRpg(p.coins >= gold, 'Altının yetmiyor.'); p.coins -= gold; credit(q, gold, 0, false); }
      else {
        const gear = itemById(item); requireRpg(gear, 'Geçersiz eşya.');
        if (gear.slot === 'potion') { requireRpg((p.bag[item] || 0) > 0, 'Bu iksir sende yok.'); giveItem(q, item); p.bag[item]--; }
        else {
          requireRpg(p.inventory.includes(item), 'Bu eşya sende yok.'); giveItem(q, item);
          p.inventory = p.inventory.filter(value => value !== item);
          if (p[gear.slot] === item) p[gear.slot] = p.inventory.map(itemById).filter(i => i?.slot === gear.slot).sort((a,b) => b.tier-a.tier)[0]?.id || null;
        }
      }
      p.updatedAt = q.updatedAt = now();
      return [p, q, { from: from.id, to: to.id, gold: gold || null, item: item || null, createdAt: now() }];
    });
    audit(guildId, from, 'rpg.transfer', 'Oyuncular arasında RPG transferi tamamlandı.', { recipientId: to.id, recipientName: title(to), gold: gold || null, item: item || null });
    return `${escapeMarkdown(title(to))} adlı oyuncuya **${gold ? `${gold} altın` : itemById(item).name}** gönderildi.`;
  }
  function challenge(guildId, from, to, stake, id) {
    requireRpg(to && !to.bot && to.id !== from.id, 'Kendinle veya botla düello yapamazsın.');
    requireRpg(Number.isSafeInteger(stake) && stake >= 1 && stake <= 500, 'Düello miktarı 1–500 altın olmalı.');
    for (const user of [from,to]) { const p=profile(guildId,user); requireRpg(!p.fight && p.coins>=stake, 'İki oyuncunun da yeterli altını olmalı ve zindanda olmamalı.'); requireRpg(!(p.cooldowns.duel>now()), 'Oyunculardan birinin düello bekleme süresi devam ediyor (10 dakika).'); }
    store.updateRecord(guildId,'rpg_duel',id,saved=>{requireRpg(!saved,'Bu davet zaten oluşturuldu.');return {from:from.id,to:to.id,fromName:title(from),toName:title(to),stake,status:'pending',expiresAt:now()+120000};});
    return `⚔️ ${escapeMarkdown(title(to))}, ${escapeMarkdown(title(from))} seni düelloya çağırıyor.\nİki oyuncu da **${stake} altını** riske eder. Kazanan kaybedenden bu miktarı alır; eşitlikte transfer olmaz. Kabul süresi **2 dakika**. Ekipman, sınıf ve seviye + d20 karşılaştırılır.`;
  }
  function resolveDuel(guildId, actor, id, accept) {
    const invitation=store.getRecord(guildId,'rpg_duel',id);requireRpg(invitation,'Düello bulunamadı.');
    requireRpg(actor.id===invitation.to,'Bu davete yalnızca davet edilen oyuncu cevap verebilir.');
    let result;
    store.transactRecords(guildId,[{kind:'rpg_duel',id},{kind:'rpg_player',id:invitation.from},{kind:'rpg_player',id:invitation.to}],([d,a,b])=>{
      requireRpg(d?.status==='pending' && d.expiresAt>now(),'Bu davet sona ermiş veya cevaplanmış.');
      const p=normalize(a,d.fromName,now()),q=normalize(b,d.toName,now());
      if(!accept){d.status='rejected';result='Düello daveti reddedildi. Altın aktarılmadı.';return [d,p,q];}
      for(const player of [p,q]){requireRpg(!player.fight && player.coins>=d.stake,'İki oyuncunun da yeterli altını olmalı ve zindanda olmamalı.');requireRpg(!(player.cooldowns.duel>now()),'Düello bekleme süresi henüz dolmadı.');}
      const left=roll(1,21)+power(p),right=roll(1,21)+power(q);
      if(left!==right){const winner=left>right?p:q,loser=left>right?q:p;credit(winner,d.stake,0,false);loser.coins-=d.stake;winner.pvpWins++;loser.pvpLosses++;}
      p.cooldowns.duel=q.cooldowns.duel=now()+600000;d.status='resolved';d.resolvedAt=now();
      result=`${escapeMarkdown(p.name)}: **${left}** · ${escapeMarkdown(q.name)}: **${right}**\n${left===right?'Berabere. Altın aktarılmadı.':`${escapeMarkdown(left>right?p.name:q.name)} kazandı: **+${d.stake} altın**.`}`;
      return [d,p,q];
    });
    audit(guildId, actor, 'rpg.duel', accept ? 'RPG düellosu tamamlandı.' : 'RPG düellosu reddedildi.', { challengeId: id, from: invitation.from, to: invitation.to, stake: invitation.stake, result });
    return result;
  }
  return {transfer,challenge,resolveDuel};
}
