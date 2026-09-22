import { randomInt, randomUUID } from 'node:crypto';
import { SlashCommandBuilder, MessageFlags, escapeMarkdown, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { ITEMS, MONSTERS, DUNGEONS, CLASSES, RECIPES, QUESTS, MATERIAL_NAMES, LIMIT, DAY, EQUIPMENT_SLOTS, level, itemById, normalize, world, power, credit, giveItem, advancedAction, RpgError, requireRpg } from './rpg-system.js';
import { createSocial } from './rpg-social.js';
import { GARAGE_UPGRADES, garageAction, garageState, garageWorkDuration, resolveGarageShift } from './rpg-garage.js';
export { ITEMS as RPG_ITEMS, MONSTERS as RPG_MONSTERS, level as rpgLevel } from './rpg-system.js';
const waits = { work: 1800000, mine: 900000, battle: 120000, gamble: 60000 };
const noMentions = { parse: [] }, title = user => user.globalName || user.username;
const choices = items => items.map(item => ({ name: item.name, value: item.id }));
const slots = { sword: 'saldırı', armor: 'savunma', helmet: 'savunma', gloves: 'savunma', boots: 'savunma', pants: 'savunma', cloak: 'savunma', pickaxe: '% maden geliri', axe: '% çalışma geliri', potion: 'etki' };
const shopItems = ITEMS.filter(item => !item.source);
const activityDurations = { mine: waits.mine, work: waits.work };
const rarityNames = ['Yaygın', 'Yaygın', 'Sıra dışı', 'Nadir', 'Destansı', 'Efsanevi', 'Mitik'];
export const RPG_GUIDE = [
  '⚔️ **Pit-Stop RPG rehberi**',
  '**Kazan:** /vardiya veya /çalış ile süreli garaj mesaisi, /maden ile 15 dakikalık kazı başlat. Süre dolunca Discord düğmesinden ya da web panelinden ödülü topla. /günlük seri ödülü, /görev günlük hedeftir.',
  '**Garaj:** /garaj seviyeni ve çalışanını gösterir. /garaj-market ile yükseltme al. /işe-al, /ikramiye-ver, /izin-ver, /mesai-topla, /otomatik-mesai ve /tamir-et personel yönetimidir. /yol-yardım çekici yan görevidir.',
  '**Ekipman:** /mağaza veya /market menüsünden al; /satın-al ile doğrudan seç. /profil envanterini gösterir. /iksir can veya 30 dakikalık şans etkisi sağlar. Kazma maden, balta çalışma gelirini artırır.',
  '**Sınıflar:** Seviye 10’da /sınıf ile kalıcı seçim yap: Savaşçı /öfke, Büyücü /ateş-topu, Okçu /nişan. Yetenekler 30 dk, normal /savaş 2 dk bekler. d20 + ekipman + seviye + sınıf gücü karşılaştırılır; eşitlikte oyuncu kazanır.',
  '**Zindan:** /zindan ile Kolay, Orta veya Zor seç. Zorluk arttıkça boss gücü, ödül ve eşya kalitesi yükselir. Saldır, İksir İç ve Kaç düğmeleri kullanılır; giriş beklemesi 1 saattir.',
  '**Üretim:** /üret tariflerle demir, odun, kristal ve boss parçalarını birleştirir. /karaborsa günde iki saat açılır; Venomancer Arachna kılıcı %25 ihtimalle saldırıyı 10 azaltır. /dünya hava, gece ve açılış saatlerini gösterir.',
  '**Sosyal:** /gönder ile aynı sunucudaki oyuncuya altın veya eşya aktar. /düello için rakibin onayı şart; 2 dakikada kabul edilmezse biter. İki taraf da seçilen 1–500 altını riske eder. /sıralama ilk 10 oyuncuyu gösterir.',
  '**Meyhane:** /zar-at veya /bahis; 10–500 sanal altın. d6’da 5–6 iki kat brüt ödeme (1/3), 1–4 kayıp; 1 dk bekleme. Gerçek para değeri yoktur.',
  'Kayıtlar sunucuya özeldir ve yeniden başlatmada korunur. /rpg-rehber ile yeniden aç.',
].join('\n\n');
export function rpgDashboard(store, guildId) {
  return { updatedAt:Date.now(),items:ITEMS,monsters:MONSTERS,dungeons:DUNGEONS,classes:CLASSES,recipes:RECIPES,quests:QUESTS,world:world(Date.now(),guildId),
    commands:createRpg(store).commands.map(({data})=>{const c=data.toJSON();return {name:c.name,description:c.description,usage:`/${c.name}${(c.options||[]).map(o=>` ${o.name}:...`).join('')}`};}),
    leaderboard:store.rpgLeaderboard(guildId).map((p,index)=>{const equipment=Object.fromEntries(EQUIPMENT_SLOTS.map(slot=>[slot,itemById(p[slot])?.name||null]));return {rank:index+1,name:p.name,level:level(p.xp),xp:p.xp,coins:p.coins,wins:p.wins,losses:p.losses,sword:equipment.sword,armor:equipment.armor,equipment,className:CLASSES.find(c=>c.id===p.classId)?.name||'Sınıf seçilmedi',pvpWins:p.pvpWins||0};}),
  };
}
export function createRpg(store, { now=Date.now,roll=randomInt,client,logger=()=>{} }={}) {
  function profile(guildId,user){return normalize(store.getRecord(guildId,'rpg_player',user.id),title(user),now());}
  function perform(p,guildId,action,choice,interactionId,time,{cooldown=true,garageMode=false}={}) {
    const w=world(time,guildId);
    requireRpg(!p.fight||['dungeonTurn','quest','daily'].includes(action),'Önce mevcut zindanını tamamla veya Kaç düğmesini kullan. /zindan ile devam et.');
    let result;
    if(action==='work'||action==='mine') {
      const chance=15+(w.night?5:0)+(w.weather==='Meteor yağmuru'?5:0)+(p.classId==='okcu'?5:0)+(p.luckUntil>time?20:0);
      const rare=action==='mine'&&roll(1,101)<=chance;
      const base=action==='work'?roll(50,101):rare?roll(100,181):roll(25,66);
      const bonus=itemById(p[action==='mine'?'pickaxe':'axe'])?.bonus||0;
      let earned=Math.floor(base*(1+bonus/100)), characterXp=action==='work'?35:rare?45:25, garageResult=null;
      if(action==='work'&&garageMode) {
        garageResult=resolveGarageShift(p,{time,roll,baseGold:earned,baseXp:characterXp});
        earned=garageResult.gold;characterXp=garageResult.xp;
      }
      credit(p,earned,characterXp);
      if(garageResult?.penalty)p.coins=Math.max(0,p.coins-garageResult.penalty);
      const material=action==='work'?'wood':'iron',quantity=roll(1,4);p.materials[material]=Math.min(LIMIT,(p.materials[material]||0)+quantity);
      if(rare)p.materials.crystal=Math.min(LIMIT,(p.materials.crystal||0)+1);
      p.quest.activities=(p.quest.activities||0)+1;
      result=`${rare?'💎 Nadir kristal buldun!':action==='work'?'🔧 Vardiyan bitti.':'⛏️ Cevher çıkardın.'}\n**+${earned} altın${garageResult?.penalty?` · -${garageResult.penalty} masraf`:''}** · Bakiye: **${p.coins}**\n+${quantity} ${MATERIAL_NAMES[material]}${rare?' · +1 Kristal':''}${action==='mine'?` · Nadir bulma: %${chance} (${w.night?'Gece':'Gündüz'}, ${w.weather})`:''}${garageResult?`\n+${garageResult.garageXp} Garaj XP · Garaj Seviye ${garageResult.level.level}${garageResult.double?' · Çifte vardiya!':''}${garageResult.employeeNote?` · ${garageResult.employeeNote}`:''}${garageResult.eventText?`\n${garageResult.eventText}`:''}`:''}`;
    } else if(action==='buy') {
      const item=itemById(choice);requireRpg(item&&!['craft','dungeon'].includes(item.source),'Bu eşya mağazada bulunamadı.');
      requireRpg(item.source!=='blackmarket'||w.marketOpen,'Karaborsa şu anda kapalı. /karaborsa ile saatlerine bak.');
      requireRpg(p.coins>=item.price,'Altının yetmiyor.');giveItem(p,item.id);p.coins-=item.price;
      result=`🛍️ **${item.name}** satın aldın. Bakiye: **${p.coins} altın**. En güçlü ekipman otomatik kuşanılır.`;
    } else if(action==='battle') {
      const monster=MONSTERS.find(m=>m.id===(typeof choice==='object'?choice?.monster:choice));requireRpg(monster,'Geçerli bir canavar seç.');
      requireRpg(p.hp>0,'Canın tükendi. /iksir ile iyileş veya dinlen.');
      let skillBonus=0;
      if(choice?.skill){const c=CLASSES.find(c=>c.id===p.classId);requireRpg(c?.skill===choice.skill,'Bu yetenek seçtiğin sınıfa ait değil. /sınıf ile kontrol et.');requireRpg(!(p.cooldowns.skill>time),'Sınıf yeteneğin için 30 dakikalık bekleme süresinin dolması gerekiyor.');skillBonus={savasci:7,buyucu:9,okcu:8}[c.id];p.cooldowns.skill=time+1800000;}
      const die=roll(1,21),enemyDie=roll(1,21),bonus=power(p);
      const curse=itemById(p.sword)?.cursed&&roll(1,101)<=25?10:0,total=die+bonus+skillBonus-curse,enemy=enemyDie+monster.defense,win=total>=enemy;
      if(win){credit(p,monster.reward,monster.xp);p.wins++;p.quest.battles=(p.quest.battles||0)+1;if(monster.id==='goblin')p.quest.goblins++;}else{p.losses++;p.hp=Math.max(0,p.hp-10);}
      const lost=win?0:Math.min(p.coins,Math.ceil(monster.reward/5));p.coins-=lost;
      result=`⚔️ **${monster.name}**\nSen: d20 **${die}** + güç ${bonus} + yetenek ${skillBonus} − lanet ${curse} = **${total}**\nCanavar: d20 **${enemyDie}** + güç ${monster.defense} = **${enemy}**\n${win?`🏆 Kazandın! +${monster.reward} altın · +${monster.xp} XP`:`Yenildin. ${lost} altın ve 10 can kaybettin; ekipmanın sende kaldı.`}\nBakiye: **${p.coins}** · Seviye **${level(p.xp)}**`;
    } else if(['garageBuy','hireEmployee','employeeBonus','employeeLeave','employeeCollect','autoWork','repairEmployee','roadside'].includes(action)) {
      try { result=garageAction(p,action,choice,{time,roll}); }
      catch(error) { throw new RpgError(error.message); }
    } else result=advancedAction(p,action,choice,{time,roll,guildId,interactionId});
    if(cooldown&&waits[action])p.cooldowns[action]=time+waits[action];
    return result;
  }
  function transaction(p,userId,action,before,result,time,interactionId,extra={}) {
    const amount=p.coins-before.coins,earned=Math.max(0,amount),spent=Math.max(0,-amount);
    p.economy={earned:(p.economy?.earned||0)+earned,spent:(p.economy?.spent||0)+spent};
    p.history=[{id:interactionId,action,amount,text:String(result).replace(/[*_`]/gu,'').split('\n')[0].slice(0,180),createdAt:time},...(p.history||[])].slice(0,30);
    return {playerId:userId,type:action,amount,balanceBefore:before.coins,balanceAfter:p.coins,xpBefore:before.xp,xpAfter:p.xp,metadata:extra,createdAt:time};
  }
  function act(guildId,user,action,choice,interactionId=randomUUID()) {
    let result;
    store.transactRecords(guildId,[{kind:'rpg_player',id:user.id},{kind:'rpg_activity',id:user.id},{kind:'rpg_transaction',id:interactionId}],([saved,currentActivity,receipt])=>{
      const time=now(),p=normalize(saved,title(user),time),before={coins:p.coins,xp:p.xp};
      requireRpg(!receipt&&!p.receipts.includes(interactionId),'Bu işlem zaten tamamlandı. /profil ile durumunu görebilirsin.');
      if(['work','mine','battle','dungeon','roadside','autoWork'].includes(action)) requireRpg(!currentActivity||!['active','ready'].includes(currentActivity.status),'Şu anda başka bir etkinlik yapıyorsun. Önce mevcut etkinliğin ödülünü toplamalısın.');
      requireRpg(!waits[action]||!(p.cooldowns[action]>time),`Bu işlem için ${Math.ceil(((p.cooldowns[action]||0)-time)/60000)} dakika daha beklemelisin.`);
      result=perform(p,guildId,action,choice,interactionId,time);
      p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;
      return [p,currentActivity||{playerId:user.id,status:'idle'},transaction(p,user.id,action,before,result,time,interactionId,{choice:typeof choice==='string'?choice:choice?.monster||null})];
    });
    return result;
  }
  function startActivity(guildId,user,type,interactionId=randomUUID(),source='web') {
    requireRpg(Object.hasOwn(activityDurations,type),'Geçerli bir etkinlik seç.');
    let created;
    store.transactRecords(guildId,[{kind:'rpg_player',id:user.id},{kind:'rpg_activity',id:user.id},{kind:'rpg_transaction',id:interactionId}],([saved,current,receipt])=>{
      const time=now(),p=normalize(saved,title(user),time),before={coins:p.coins,xp:p.xp};
      requireRpg(!receipt&&!p.receipts.includes(interactionId),'Bu işlem zaten tamamlandı.');
      requireRpg(!current||['idle','claimed','cancelled'].includes(current.status),'Şu anda başka bir işlem yapıyorsun. Mevcut işlemi tamamlamalısın.');
      requireRpg(!(p.cooldowns[type]>time),`Bu işlem için ${Math.ceil((p.cooldowns[type]-time)/60000)} dakika daha beklemelisin.`);
      requireRpg(!p.fight,'Zindandayken başka bir etkinlik başlatamazsın.');
      const duration=type==='work'?garageWorkDuration(p):activityDurations[type];
      const endsAt=time+duration;
      created={id:interactionId,playerId:user.id,type,startedAt:time,endsAt,status:'active',metadata:{source},rewardData:null,claimedAt:null};
      p.cooldowns[type]=endsAt;p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;
      const message=type==='mine'?'Demir madenine girdin.':'Garaj vardiyasına başladın.';
      return [p,created,transaction(p,user.id,`${type}_started`,before,message,time,interactionId,{endsAt})];
    });
    return created;
  }
  function claimActivity(guildId,user,interactionId=randomUUID()) {
    let result,completed;
    store.transactRecords(guildId,[{kind:'rpg_player',id:user.id},{kind:'rpg_activity',id:user.id},{kind:'rpg_transaction',id:interactionId}],([saved,current,receipt])=>{
      const time=now(),p=normalize(saved,title(user),time),before={coins:p.coins,xp:p.xp};
      requireRpg(!receipt&&!p.receipts.includes(interactionId),'Bu ödül zaten alındı.');
      requireRpg(current&&current.status==='active','Toplanmayı bekleyen bir etkinlik ödülü yok.');
      requireRpg(current.endsAt<=time,`Etkinliğin tamamlanmasına ${Math.max(1,Math.ceil((current.endsAt-time)/1000))} saniye var.`);
      result=perform(p,guildId,current.type,null,interactionId,time,{cooldown:false,garageMode:current.type==='work'});
      completed={...current,status:'claimed',claimedAt:time,rewardData:{gold:p.coins-before.coins,xp:p.xp-before.xp,result}};
      p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;
      return [p,completed,transaction(p,user.id,`${current.type}_reward`,before,result,time,interactionId,{activityId:current.id})];
    });
    return {activity:completed,result};
  }
  function equip(guildId,user,itemId,interactionId=randomUUID()) {
    let result;
    store.transactRecords(guildId,[{kind:'rpg_player',id:user.id},{kind:'rpg_transaction',id:interactionId}],([saved,receipt])=>{
      const time=now(),p=normalize(saved,title(user),time),before={coins:p.coins,xp:p.xp},item=itemById(itemId);
      requireRpg(!receipt&&!p.receipts.includes(interactionId),'Bu işlem zaten tamamlandı.');
      requireRpg(item&&item.slot!=='potion','Bu eşya kuşanılamaz.');
      requireRpg(p.inventory.includes(item.id),'Bu eşya envanterinde bulunmuyor.');
      p[item.slot]=item.id;result=`${item.name} kuşanıldı.`;
      p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;
      return [p,transaction(p,user.id,'equip',before,result,time,interactionId,{itemId:item.id,slot:item.slot})];
    });
    return result;
  }
  function sell(guildId,user,itemId,interactionId=randomUUID()) {
    let result;
    store.transactRecords(guildId,[{kind:'rpg_player',id:user.id},{kind:'rpg_transaction',id:interactionId}],([saved,receipt])=>{
      const time=now(),p=normalize(saved,title(user),time),before={coins:p.coins,xp:p.xp},item=itemById(itemId);
      requireRpg(!receipt&&!p.receipts.includes(interactionId),'Bu satış zaten tamamlandı.');
      requireRpg(item&&!item.source,'Yalnızca normal mağazadan alınan eşyalar satılabilir.');
      if(item.slot==='potion') {
        requireRpg((p.bag[item.id]||0)>0,'Bu eşya envanterinde bulunmuyor.');
        p.bag[item.id]--;
      } else {
        requireRpg(p.inventory.includes(item.id),'Bu eşya envanterinde bulunmuyor.');
        p.inventory=p.inventory.filter(id=>id!==item.id);
        if(p[item.slot]===item.id) {
          const replacement=ITEMS.filter(candidate=>candidate.slot===item.slot&&p.inventory.includes(candidate.id)).sort((a,b)=>b.tier-a.tier||b.bonus-a.bonus)[0];
          p[item.slot]=replacement?.id||null;
        }
      }
      const salePrice=Math.max(1,Math.floor(item.price*0.5));credit(p,salePrice,0,false);
      result=`${item.name} **${salePrice} altına** satıldı. Bakiye: **${p.coins} altın**.`;
      p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;
      return [p,transaction(p,user.id,'sell',before,result,time,interactionId,{itemId:item.id,salePrice})];
    });
    return result;
  }
  function webState(guildId,user,{avatar=null}={}) {
    const time=now(),p=profile(guildId,user),w=world(time,guildId),rawActivity=store.getRecord(guildId,'rpg_activity',user.id);
    const hasValidActivity=rawActivity&&['active','ready'].includes(rawActivity.status)&&Number.isFinite(Number(rawActivity.startedAt))&&Number.isFinite(Number(rawActivity.endsAt));
    const activity=hasValidActivity?(Number(rawActivity.endsAt)<=time?{...rawActivity,status:'ready'}:rawActivity):null;
    const classInfo=CLASSES.find(c=>c.id===p.classId)||null;
    const currentLevel=level(p.xp),xpStart=(currentLevel-1)**2*100,xpEnd=currentLevel**2*100;
    const equipment=Object.fromEntries([...EQUIPMENT_SLOTS,'pickaxe','axe'].map(slot=>[slot,itemById(p[slot])||null]));
    const defense=EQUIPMENT_SLOTS.filter(slot=>slot!=='sword').reduce((total,slot)=>total+(itemById(p[slot])?.bonus||0),0);
    const inventory=ITEMS.filter(item=>p.inventory.includes(item.id)||(p.bag[item.id]||0)>0).map(item=>({...item,rarity:rarityNames[item.tier]||'Mitik',quantity:item.slot==='potion'?(p.bag[item.id]||0):1,equipped:p[item.slot]===item.id,sellable:!item.source,sellPrice:!item.source?Math.max(1,Math.floor(item.price*0.5)):null}));
    const startOfDay=Date.UTC(Number(w.date.slice(0,4)),Number(w.date.slice(5,7))-1,Number(w.date.slice(8,10)))-3*3600_000;
    const nextOpenHour=w.openHours.find(hour=>hour>w.hour);
    const marketTarget=w.marketOpen?startOfDay+(w.hour+1)*3600_000:startOfDay+((nextOpenHour??(24+w.openHours[0]))*3600_000);
    const transactions=store.listRecords(guildId,'rpg_transaction',500).filter(entry=>entry.playerId===user.id).slice(0,20);
    return {
      serverTime:time,updatedAt:time,
      player:{id:user.id,name:p.name,avatar,level:currentLevel,xp:p.xp,xpStart,xpEnd,hp:p.hp,coins:p.coins,classId:p.classId,className:classInfo?.name||'Sınıf seçilmedi',power:power(p),defense,luckUntil:p.luckUntil||null,wins:p.wins,losses:p.losses,pvpWins:p.pvpWins||0,pvpLosses:p.pvpLosses||0,economy:p.economy||{earned:0,spent:0},materials:p.materials,daily:{...p.daily,nextAt:p.daily.lastAt?Number(p.daily.lastAt)+DAY:time,available:!p.daily.lastAt||time-Number(p.daily.lastAt)>=DAY},timers:p.cooldowns,quest:p.quest,fight:p.fight||null,lastAction:p.history?.[0]?{action:p.history[0].action,text:p.history[0].text,createdAt:p.history[0].createdAt}:null},
      activity,inventory,equipment,
      items:ITEMS.map(item=>({...item,rarity:rarityNames[item.tier]||'Mitik',owned:p.inventory.includes(item.id),quantity:p.bag[item.id]||0,equipped:p[item.slot]===item.id})),
      monsters:MONSTERS,dungeons:DUNGEONS,classes:CLASSES,recipes:RECIPES,
      quests:QUESTS.map(q=>({...q,progress:Math.min(q.target,p.quest[q.field]||0),claimed:p.quest.claimed.includes(q.id)})),
      commands:commands.map(({data})=>{const command=data.toJSON();return {name:command.name,description:command.description,usage:`/${command.name}${(command.options||[]).map(option=>` ${option.name}:...`).join('')}`};}),
      world:{...w,marketTarget},garage:garageState(p,time),transactions,
      leaderboard:store.rpgLeaderboard(guildId).map((entry,index)=>{const gear=Object.fromEntries(EQUIPMENT_SLOTS.map(slot=>[slot,itemById(entry[slot])?.name||null]));return {rank:index+1,id:entry.id,name:entry.name,level:level(entry.xp),xp:entry.xp,coins:entry.coins,wins:entry.wins||0,losses:entry.losses||0,bossKills:entry.bossKills||0,className:CLASSES.find(c=>c.id===entry.classId)?.name||'Sınıfsız',sword:gear.sword,armor:gear.armor,equipment:gear};}),
    };
  }
  const {transfer,challenge,resolveDuel}=createSocial(store,{now,roll,profile});
  const row=buttons=>new ActionRowBuilder().addComponents(buttons.map(([id,label,style])=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style||ButtonStyle.Secondary)));
  function fightButtons(i){const f=profile(i.guildId,i.user).fight;return f?[row([['attack','Saldır',ButtonStyle.Primary],['heal','İksir İç'],['flee','Kaç',ButtonStyle.Danger]].map(([move,label,style])=>[`rpg:fight:${i.user.id}:${f.id}:${f.turn}:${move}`,label,style]))]:[];}
  const activityButtons=userId=>[row([[`rpg:activity:${userId}:claim`,'Ödülü al',ButtonStyle.Primary]])];
  function activityCommand(i,type) {
    const current=store.getRecord(i.guildId,'rpg_activity',i.user.id),time=now(),label=type==='mine'?'⛏️ Maden':'🔧 Garaj vardiyası';
    if(current&&['active','ready'].includes(current.status)) {
      const currentLabel=current.type==='mine'?'⛏️ Maden':'🔧 Garaj vardiyası';
      if(Number(current.endsAt)<=time)return {content:`${currentLabel} tamamlandı. Ödülün hazır; aşağıdaki düğmeyle hesabına aktar.`,components:activityButtons(i.user.id)};
      return {content:`${currentLabel} devam ediyor. <t:${Math.floor(Number(current.endsAt)/1000)}:R> tamamlanacak. Süre dolunca **Ödülü al** düğmesini kullan.`,components:activityButtons(i.user.id)};
    }
    const activity=startActivity(i.guildId,i.user,type,i.id,'discord');
    return {content:`${label} başladı. <t:${Math.floor(activity.endsAt/1000)}:R> tamamlanacak. Ödül otomatik verilmez; süre dolunca aşağıdaki düğmeyle almalısın.`,components:activityButtons(i.user.id)};
  }
  function shop(i,black=false){
    const w=world(now(),i.guildId),items=black?ITEMS.filter(i=>i.source==='blackmarket'):shopItems,open=!black||w.marketOpen;
    return {content:`🛍️ **${black?'Karaborsa':'Pit-Stop market'}**\n${items.map(item=>`**${item.name}** — ${item.price} altın · +${item.bonus} ${slots[item.slot]}`).join('\n')}\n${black?`İstanbul saati: ${w.openHours.map(h=>`${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`).join(', ')}. ${open?'Açık.':'Kapalı.'}\nVenomancer Arachna kılıcı: %25 ihtimalle PvE saldırısından 10 güç düşer.`:'Menüden seçtiğin eşya, yazan altın karşılığında hemen satın alınır. /satın-al da kullanılabilir.'}`,components:open?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`rpg:shop:${i.user.id}`).setPlaceholder('Fiyatını kontrol et, satın almak için seç').addOptions(items.map(item=>({label:`${item.name} · ${item.price} altın`,value:item.id}))))]:[]};
  }
  async function announce(i){
    const p=profile(i.guildId,i.user);if(p.achievement?.id!==i.id)return;
    const channelId=store.getSettings(i.guildId).rpgAnnouncementChannelId;
    try{store.addLog(i.guildId,{type:'rpg.achievement',actorId:i.user.id,message:p.achievement.text,details:{actorName:title(i.user)}});if(channelId&&client){const channel=await client.channels.fetch(channelId);if(channel?.guildId===i.guildId)await channel.send({content:`🏆 **${escapeMarkdown(title(i.user))}** ${p.achievement.text}`,allowedMentions:noMentions});}}
    catch{logger('error','rpg_announcement_failed',{guildId:i.guildId});}
  }
  async function guildUser(i,user){requireRpg(user&&!user.bot,'Bir oyuncu seç.');const member=await i.guild.members.fetch(user.id).catch(()=>null);requireRpg(member,'Oyuncu bu sunucuda bulunmuyor.');return user;}
  async function autocompleteTransferItem(i){
    const p=profile(i.guildId,i.user),query=String(i.options.getFocused()||'').toLocaleLowerCase('tr-TR');
    const owned=ITEMS.filter(item=>p.inventory.includes(item.id)||(p.bag[item.id]||0)>0)
      .filter(item=>!query||item.name.toLocaleLowerCase('tr-TR').includes(query)||item.id.includes(query))
      .slice(0,25)
      .map(item=>({name:`${item.name}${item.slot==='potion'?` · ${p.bag[item.id]} adet`:''}`,value:item.id}));
    await i.respond(owned);
  }
  const option=(data,name,description,items,required=true)=>data.addStringOption(o=>o.setName(name).setDescription(description).setRequired(required).addChoices(...choices(items)));
  const monsterOption=data=>option(data,'canavar','Savaşılacak canavar',MONSTERS);
  const command=(name,description,handler,configure=data=>data,autocomplete)=>({
    data:configure(new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0).setIntegrationTypes(0)),
    ...(autocomplete?{autocomplete}:{}),
    async execute(i){
      if(!i.inGuild())return i.reply({content:'Bu komutu bir sunucuda kullanın.',flags:MessageFlags.Ephemeral});
      await i.deferReply(['sıralama','düello'].includes(name)?{}:{flags:MessageFlags.Ephemeral});
      try{const result=await handler(i);await i.editReply({...(typeof result==='string'?{content:result,components:[]}:result),allowedMentions:noMentions});await announce(i);}
      catch(error){if(!(error instanceof RpgError))throw error;await i.editReply({content:error.message,components:[],allowedMentions:noMentions});}
    },
  });
  const mutate=(action,field)=>i=>act(i.guildId,i.user,action,field?i.options.getString(field):null,i.id);
  const commands=[
    command('rpg-rehber','RPG komutları, sınıflar, zindan ve ekonomi rehberi.',()=>RPG_GUIDE),
    command('çalış','30 dakikalık garaj vardiyası başlat; bitince ödülü topla.',i=>activityCommand(i,'work')),
    command('vardiya','Garaj vardiyası başlat veya devam eden etkinliğini görüntüle.',i=>activityCommand(i,'work')),
    command('maden','15 dakikalık kazı başlat; bitince ödülü topla.',i=>activityCommand(i,'mine')),
    command('günlük','24 saatte bir artan seri ödülünü al.',mutate('daily')),
    command('mağaza','Ekipman, kazma, balta ve iksir marketini aç.',i=>shop(i)),
    command('market','İnteraktif ekipman ve iksir marketini aç.',i=>shop(i)),
    command('satın-al','Altın karşılığında bir market eşyası al.',mutate('buy','eşya'),d=>option(d,'eşya','Satın alınacak eşya',shopItems)),
    command('savaş','d20 ile canavara meydan oku. Bekleme: 2 dakika.',mutate('battle','canavar'),monsterOption),
    command('sınıf','Seviye 10: kalıcı Savaşçı, Büyücü veya Okçu seç.',mutate('class','seçim'),d=>option(d,'seçim','Sınıf seçimi kalıcıdır',CLASSES)),
    ...CLASSES.map(c=>command(c.skill,`${c.name} yeteneği. Bekleme: 30 dakika.`,i=>act(i.guildId,i.user,'battle',{monster:i.options.getString('canavar'),skill:c.skill},i.id),monsterOption)),
    command('iksir','Can veya 30 dakikalık şans iksiri kullan.',mutate('potion','tür'),d=>option(d,'tür','Kullanılacak iksir',ITEMS.filter(i=>i.slot==='potion'))),
    command('görev','Kolay, orta ve zor günlük görevleri gör; ödülünü al.',i=>{const id=i.options.getString('ödül');if(id)return act(i.guildId,i.user,'quest',id,i.id);const p=profile(i.guildId,i.user);return `**Günlük görevler · ${p.quest.date}**\n${QUESTS.map(q=>`**${q.difficulty}** · ${q.name}: **${Math.min(q.target,p.quest[q.field]||0)}/${q.target}** · ${q.gold} altın, ${q.xp} XP${p.quest.claimed.includes(q.id)?' · Ödül alındı':''}`).join('\n')}\n/görev ödül:... ile al. İstanbul gece yarısında sıfırlanır; transfer, günlük ve bahis geliri sayılmaz.`;},d=>option(d,'ödül','Tamamlanan görevin ödülü',QUESTS,false)),
    command('üret','Tarifleri gör veya malzemelerle eşya üret.',i=>{const id=i.options.getString('tarif');return id?act(i.guildId,i.user,'craft',id,i.id):`**Üretim tarifleri**\n${RECIPES.map(r=>`**${r.name}**: ${Object.entries(r.materials).map(([id,n])=>`${n} ${MATERIAL_NAMES[id]}`).join(', ')} + ${r.gold} altın`).join('\n')}\n/üret tarif:... ile üret.`;},d=>option(d,'tarif','Üretilecek eşya',RECIPES,false)),
    command('karaborsa','Gizli tüccarın günlük saatleri ve özel eşyaları.',i=>shop(i,true)),
    command('garaj','Garaj seviyeni, ekipmanını ve çalışan durumunu göster.',i=>{const g=garageState(profile(i.guildId,i.user),now());return `🏁 **${g.name} · Seviye ${g.level}/10**\nGaraj XP: **${g.xp}${g.nextXp?` / ${g.nextXp}`:' · MAKSİMUM'}** · Araç kapasitesi: **${g.capacity??'Sınırsız'}**\nVardiya geliri: **+%${g.incomeBonus}** · Tamamlanan vardiya: **${g.shifts}**\nEkipman: ${Object.values(g.equipped).filter(Boolean).map(id=>GARAGE_UPGRADES.find(item=>item.id===id)?.name).filter(Boolean).join(', ')||'Başlangıç ekipmanı'}\nÇalışan: ${g.employee?`**${g.employee.title}** · Moral ${g.employee.morale}/100 · ${g.employee.pending.amount} PitCoin bekliyor`:'Yok · Hidrolik lift aldıktan sonra /işe-al'}\nÇekici: ${GARAGE_UPGRADES.find(item=>item.id===g.equipped.tow)?.name||'Yok'}`;}),
    command('garaj-market','Garaj, çalışan ve çekici ekipmanı satın al.',i=>{const id=i.options.getString('ekipman');if(id)return act(i.guildId,i.user,'garageBuy',id,i.id);const g=garageState(profile(i.guildId,i.user),now());return `**Garaj marketi · Seviye ${g.level}**\n${GARAGE_UPGRADES.filter(item=>item.price).map(item=>`${item.unlocked?'🔓':'🔒'} **${item.name}** — ${item.price} PitCoin · Seviye ${item.level}${item.owned?' · Alındı':''}`).join('\n')}\n/garaj-market ekipman:... ile satın al.`;},d=>option(d,'ekipman','Satın alınacak garaj yükseltmesi',GARAGE_UPGRADES.filter(item=>item.price),false)),
    command('işe-al','Hidrolik lift varsa 1.500 PitCoin karşılığında Çırak al.',i=>act(i.guildId,i.user,'hireEmployee',null,i.id)),
    command('ikramiye-ver','Çalışana 200 PitCoin ikramiye vererek moralini 50 artır.',i=>act(i.guildId,i.user,'employeeBonus',null,i.id)),
    command('izin-ver','Çalışanı 24 saat izne gönder; dönüşte morali tamamlansın.',i=>act(i.guildId,i.user,'employeeLeave',null,i.id)),
    command('mesai-topla','Çalışanın tamamlanan pasif mesai gelirini topla.',i=>act(i.guildId,i.user,'employeeCollect',null,i.id)),
    command('otomatik-mesai','Şef Mekanik ile günlük otomatik mesai gelirini al.',i=>act(i.guildId,i.user,'autoWork',null,i.id)),
    command('tamir-et','Çalışanın alet ve istasyon dayanıklılığını onar.',i=>act(i.guildId,i.user,'repairEmployee',null,i.id)),
    command('yol-yardım','Çekicinle riskli yol yardım yan görevine çık.',i=>act(i.guildId,i.user,'roadside',null,i.id)),
    command('dünya','Oyun havası, gece/gündüz ve karaborsa saatleri.',i=>{const w=world(now(),i.guildId);return `**${w.date} · Europe/Istanbul · ${w.hour}:00**\n${w.night?'Gece: madende nadir bulma +5 puan.':'Gündüz.'} ${w.weather}${w.weather==='Meteor yağmuru'?' · Nadir bulma +5 puan.':''}\nKaraborsa: ${w.openHours.map(h=>`${h}:00–${h+1}:00`).join(', ')} (${w.marketOpen?'Açık':'Kapalı'}). Oyun içi hava; gerçek hava durumu değildir.`;}),
    command('zindan','Kolay, orta veya zor boss savaşına gir. Bekleme: 1 saat.',i=>{const p=profile(i.guildId,i.user),difficulty=i.options.getString('zorluk')||'orta',dungeon=DUNGEONS.find(item=>item.id===(p.fight?.difficulty||difficulty))||DUNGEONS[1];const content=p.fight?`${dungeon.label} zindana devam et. ${dungeon.name}: **${p.fight.hp}/${p.fight.maxHp||dungeon.hp}** · Sen: **${p.hp}/100**`:act(i.guildId,i.user,'dungeon',difficulty,i.id);return {content,components:fightButtons(i)};},d=>option(d,'zorluk','Zindan zorluğu',DUNGEONS.map(item=>({id:item.id,name:`${item.label} — ${item.name}`})),false)),
    command('gönder','Bir sunucu üyesine altın veya tek bir eşya gönder.',async i=>{const target=await guildUser(i,i.options.getUser('oyuncu'));return transfer(i.guildId,i.user,target,{gold:i.options.getInteger('altın'),item:i.options.getString('eşya')},i.id);},d=>d.addUserOption(o=>o.setName('oyuncu').setDescription('Alıcı oyuncu').setRequired(true)).addIntegerOption(o=>o.setName('altın').setDescription('Gönderilecek altın (eşya ile birlikte seçme)').setMinValue(1).setMaxValue(100000)).addStringOption(o=>o.setName('eşya').setDescription('Envanterindeki eşya').setAutocomplete(true)),autocompleteTransferItem),
    command('düello','Onaylı PvP: iki oyuncu da seçilen altını riske eder.',async i=>{const target=await guildUser(i,i.options.getUser('oyuncu'));const content=challenge(i.guildId,i.user,target,i.options.getInteger('altın'),i.id);return {content,components:[row([[`rpg:duel:${i.id}:accept`,'Kabul et',ButtonStyle.Primary],[`rpg:duel:${i.id}:reject`,'Reddet',ButtonStyle.Danger]])]};},d=>d.addUserOption(o=>o.setName('oyuncu').setDescription('Davet edilecek rakip').setRequired(true)).addIntegerOption(o=>o.setName('altın').setDescription('Her iki tarafın riske ettiği sanal altın').setRequired(true).setMinValue(1).setMaxValue(500))),
    ...['zar-at','bahis'].map(name=>command(name,'10–500 sanal altın: d6 5–6 kazanır, 1–4 kaybeder.',i=>act(i.guildId,i.user,'gamble',i.options.getInteger('altın'),i.id),d=>d.addIntegerOption(o=>o.setName('altın').setDescription('Risk edilecek sanal altın').setRequired(true).setMinValue(10).setMaxValue(500)))),
    command('profil','Bakiye, sınıf, can, malzeme, envanter ve savaş kaydı.',i=>{const p=profile(i.guildId,i.user);return `🧙 **${escapeMarkdown(p.name)}**\nAltın: **${p.coins}** · XP: **${p.xp}** · Seviye: **${level(p.xp)}**\nSınıf: ${CLASSES.find(c=>c.id===p.classId)?.name||'Seviye 10’da /sınıf ile seç'} · Can: **${p.hp}/100**\nSilah: ${itemById(p.sword)?.name||'Yok'} · Zırh: ${itemById(p.armor)?.name||'Yok'}\nKask: ${itemById(p.helmet)?.name||'Yok'} · Eldiven: ${itemById(p.gloves)?.name||'Yok'}\nAyakkabı: ${itemById(p.boots)?.name||'Yok'} · Pantolon: ${itemById(p.pants)?.name||'Yok'}\nPelerin: ${itemById(p.cloak)?.name||'Yok'}\nPvE: ${p.wins} galibiyet / ${p.losses} yenilgi · PvP: ${p.pvpWins} / ${p.pvpLosses}\n**Envanter:** ${p.inventory.map(id=>itemById(id)?.name).filter(Boolean).join(', ')||'Boş'}\n**İksirler:** ${ITEMS.filter(i=>i.slot==='potion').map(i=>`${i.name}: ${p.bag[i.id]||0}`).join(' · ')}\n**Malzemeler:** ${Object.entries(MATERIAL_NAMES).map(([id,label])=>`${label}: ${p.materials[id]||0}`).join(' · ')}\nŞans etkisi: ${p.luckUntil>now()?`${Math.ceil((p.luckUntil-now())/60000)} dakika`:'Kapalı'}\n/rpg-rehber ile komutları gör.`;}),
    command('sıralama','Sunucunun ilk 10 RPG oyuncusunu göster.',i=>`🏆 **Sunucu RPG sıralaması**\nÖnce XP, eşitlikte galibiyet ve altın.\n\n${store.rpgLeaderboard(i.guildId).map((p,n)=>`**${n+1}.** ${escapeMarkdown(p.name)} — ${p.xp} XP · ${p.wins} galibiyet · ${p.coins} altın`).join('\n')||'Henüz oyuncu yok. /çalış ile başla.'}`),
  ];
  async function handleInteraction(i){
    if(!(i.isButton?.()||i.isStringSelectMenu?.())||!i.customId?.startsWith('rpg:'))return;
    try{
      requireRpg(i.inGuild(),'Bu işlem yalnızca sunucuda kullanılabilir.');
      const [,kind,owner,id,turn,move]=i.customId.split(':');
      if(kind==='duel'){
        const invitation=store.getRecord(i.guildId,'rpg_duel',owner);requireRpg(invitation&&invitation.to===i.user.id,'Bu düello daveti sana ait değil.');
        await i.deferUpdate();
        if(id==='accept'){await guildUser(i,{id:invitation.from});await guildUser(i,i.user);}
        const content=resolveDuel(i.guildId,i.user,owner,id==='accept');await i.editReply({content,components:[],allowedMentions:noMentions});return;
      }
      requireRpg(owner===i.user.id,'Bu menü başka bir oyuncuya ait. Kendi komutunu kullan.');await i.deferUpdate();
      let content,components=[];
      if(kind==='shop'){content=act(i.guildId,i.user,'buy',i.values[0],i.id);components=shop(i,itemById(i.values[0])?.source==='blackmarket').components;}
      else if(kind==='fight'){content=act(i.guildId,i.user,'dungeonTurn',{id,turn:Number(turn),move},i.id);components=fightButtons(i);}
      else if(kind==='activity'){requireRpg(id==='claim','Etkinlik düğmesi artık geçerli değil.');content=claimActivity(i.guildId,i.user,i.id).result;}
      else throw new RpgError('Menü artık geçerli değil.');
      await i.editReply({content,components,allowedMentions:noMentions});await announce(i);
    }catch(error){
      const content=error instanceof RpgError?error.message:'İşlem tamamlanamadı. /profil ile kaydını kontrol edip yeniden dene.';
      if(!(error instanceof RpgError))logger('error','rpg_component_failed',{guildId:i.guildId});
      if(i.deferred||i.replied)await i.followUp({content,flags:MessageFlags.Ephemeral,allowedMentions:noMentions}).catch(()=>{});else await i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:noMentions}).catch(()=>{});
    }
  }
  return {commands,act,profile,startActivity,claimActivity,equip,sell,webState,transfer,challenge,resolveDuel,handleInteraction};
}
