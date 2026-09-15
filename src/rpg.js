import { randomInt, randomUUID } from 'node:crypto';
import { SlashCommandBuilder, MessageFlags, escapeMarkdown, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { ITEMS, MONSTERS, CLASSES, RECIPES, QUESTS, MATERIAL_NAMES, LIMIT, level, itemById, normalize, world, power, credit, giveItem, advancedAction, RpgError, requireRpg } from './rpg-system.js';
import { createSocial } from './rpg-social.js';
export { ITEMS as RPG_ITEMS, MONSTERS as RPG_MONSTERS, level as rpgLevel } from './rpg-system.js';
const waits = { work: 1800000, mine: 900000, battle: 300000, dungeon: 3600000, gamble: 60000 };
const noMentions = { parse: [] }, title = user => user.globalName || user.username;
const choices = items => items.map(item => ({ name: item.name, value: item.id }));
const slots = { sword: 'saldırı', armor: 'savunma', pickaxe: '% maden geliri', axe: '% çalışma geliri', potion: 'etki' };
const shopItems = ITEMS.filter(item => !item.source);
export const RPG_GUIDE = [
  '⚔️ **Pit-Stop RPG rehberi**',
  '**Kazan:** /çalış (30 dk), /maden (15 dk), /günlük (24 saat; seri 7 güne kadar artar). /görev ile günlük 3 Goblin ve 500 altın görevlerini takip et.',
  '**Ekipman:** /mağaza veya /market menüsünden al; /satın-al ile doğrudan seç. /profil envanterini gösterir. /iksir can veya 30 dakikalık şans etkisi sağlar. Kazma maden, balta çalışma gelirini artırır.',
  '**Sınıflar:** Seviye 10’da /sınıf ile kalıcı seçim yap: Savaşçı /öfke, Büyücü /ateş-topu, Okçu /nişan. Yetenekler 30 dk, normal /savaş 5 dk bekler. d20 + ekipman + seviye + sınıf gücü karşılaştırılır; eşitlikte oyuncu kazanır.',
  '**Zindan:** Seviye 3’te /zindan. Saldır, İksir İç, Kaç düğmeleri; 1 saat giriş bekleme. Boss +600 altın, +250 XP ve parça verir; %25 nadir kılıç şansı. Can 30 dk’da 10 yenilenir.',
  '**Üretim:** /üret tariflerle demir, odun, kristal ve boss parçalarını birleştirir. /karaborsa günde iki saat açılır; lanetli kılıç %25 ihtimalle saldırıyı 10 azaltır. /dünya hava, gece ve açılış saatlerini gösterir.',
  '**Sosyal:** /gönder ile aynı sunucudaki oyuncuya altın veya eşya aktar. /düello için rakibin onayı şart; 2 dakikada kabul edilmezse biter. İki taraf da seçilen 1–500 altını riske eder. /sıralama ilk 10 oyuncuyu gösterir.',
  '**Meyhane:** /zar-at veya /bahis; 10–500 sanal altın. d6’da 5–6 iki kat brüt ödeme (1/3), 1–4 kayıp; 1 dk bekleme. Gerçek para değeri yoktur.',
  'Kayıtlar sunucuya özeldir ve yeniden başlatmada korunur. /rpg-rehber ile yeniden aç.',
].join('\n\n');
export function rpgDashboard(store, guildId) {
  return { updatedAt:Date.now(),items:ITEMS,monsters:MONSTERS,classes:CLASSES,recipes:RECIPES,quests:QUESTS,world:world(Date.now(),guildId),
    commands:createRpg(store).commands.map(({data})=>{const c=data.toJSON();return {name:c.name,description:c.description,usage:`/${c.name}${(c.options||[]).map(o=>` ${o.name}:...`).join('')}`};}),
    leaderboard:store.rpgLeaderboard(guildId).map((p,index)=>({rank:index+1,name:p.name,level:level(p.xp),xp:p.xp,coins:p.coins,wins:p.wins,losses:p.losses,sword:itemById(p.sword)?.name||null,armor:itemById(p.armor)?.name||null,className:CLASSES.find(c=>c.id===p.classId)?.name||'Sınıf seçilmedi',pvpWins:p.pvpWins||0})),
  };
}
export function createRpg(store, { now=Date.now,roll=randomInt,client,logger=()=>{} }={}) {
  function profile(guildId,user){return normalize(store.getRecord(guildId,'rpg_player',user.id),title(user),now());}
  function act(guildId,user,action,choice,interactionId=randomUUID()) {
    let result;
    store.updateRecord(guildId,'rpg_player',user.id,saved=>{
      const time=now(),p=normalize(saved,title(user),time),w=world(time,guildId);
      requireRpg(!p.receipts.includes(interactionId),'Bu işlem zaten tamamlandı. /profil ile durumunu görebilirsin.');
      requireRpg(!waits[action]||!(p.cooldowns[action]>time),`Bu işlem için ${Math.ceil(((p.cooldowns[action]||0)-time)/60000)} dakika daha beklemelisin.`);
      requireRpg(!p.fight||['dungeonTurn','quest','daily'].includes(action),'Önce mevcut zindanını tamamla veya Kaç düğmesini kullan. /zindan ile devam et.');
      if(action==='work'||action==='mine') {
        const chance=15+(w.night?5:0)+(w.weather==='Meteor yağmuru'?5:0)+(p.classId==='okcu'?5:0)+(p.luckUntil>time?20:0);
        const rare=action==='mine'&&roll(1,101)<=chance;
        const base=action==='work'?roll(50,101):rare?roll(100,181):roll(25,66);
        const bonus=itemById(p[action==='mine'?'pickaxe':'axe'])?.bonus||0;
        const earned=Math.floor(base*(1+bonus/100));credit(p,earned,action==='work'?10:rare?20:8);
        const material=action==='work'?'wood':'iron',quantity=roll(1,4);p.materials[material]=Math.min(LIMIT,(p.materials[material]||0)+quantity);
        if(rare)p.materials.crystal=Math.min(LIMIT,(p.materials.crystal||0)+1);
        result=`${rare?'💎 Nadir kristal buldun!':action==='work'?'🔧 Vardiyan bitti.':'⛏️ Cevher çıkardın.'}\n**+${earned} altın** · Bakiye: **${p.coins}**\n+${quantity} ${MATERIAL_NAMES[material]}${rare?' · +1 Kristal':''}${action==='mine'?` · Nadir bulma: %${chance} (${w.night?'Gece':'Gündüz'}, ${w.weather})`:''}`;
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
        if(win){credit(p,monster.reward,monster.xp);p.wins++;if(monster.id==='goblin')p.quest.goblins++;}else{p.losses++;p.hp=Math.max(0,p.hp-10);}
        const lost=win?0:Math.min(p.coins,Math.ceil(monster.reward/5));p.coins-=lost;
        result=`⚔️ **${monster.name}**\nSen: d20 **${die}** + güç ${bonus} + yetenek ${skillBonus} − lanet ${curse} = **${total}**\nCanavar: d20 **${enemyDie}** + güç ${monster.defense} = **${enemy}**\n${win?`🏆 Kazandın! +${monster.reward} altın · +${monster.xp} XP`:`Yenildin. ${lost} altın ve 10 can kaybettin; ekipmanın sende kaldı.`}\nBakiye: **${p.coins}** · Seviye **${level(p.xp)}**`;
      } else result=advancedAction(p,action,choice,{time,roll,guildId,interactionId});
      if(waits[action])p.cooldowns[action]=time+waits[action];p.receipts=[...p.receipts.slice(-49),interactionId];p.updatedAt=time;return p;
    });
    return result;
  }
  const {transfer,challenge,resolveDuel}=createSocial(store,{now,roll,profile});
  const row=buttons=>new ActionRowBuilder().addComponents(buttons.map(([id,label,style])=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style||ButtonStyle.Secondary)));
  function fightButtons(i){const f=profile(i.guildId,i.user).fight;return f?[row([['attack','Saldır',ButtonStyle.Primary],['heal','İksir İç'],['flee','Kaç',ButtonStyle.Danger]].map(([move,label,style])=>[`rpg:fight:${i.user.id}:${f.id}:${f.turn}:${move}`,label,style]))]:[];}
  function shop(i,black=false){
    const w=world(now(),i.guildId),items=black?ITEMS.filter(i=>i.source==='blackmarket'):shopItems,open=!black||w.marketOpen;
    return {content:`🛍️ **${black?'Karaborsa':'Pit-Stop market'}**\n${items.map(item=>`**${item.name}** — ${item.price} altın · +${item.bonus} ${slots[item.slot]}`).join('\n')}\n${black?`İstanbul saati: ${w.openHours.map(h=>`${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`).join(', ')}. ${open?'Açık.':'Kapalı.'}\nLanetli kılıç: %25 ihtimalle PvE saldırısından 10 güç düşer.`:'Menüden seçtiğin eşya, yazan altın karşılığında hemen satın alınır. /satın-al da kullanılabilir.'}`,components:open?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`rpg:shop:${i.user.id}`).setPlaceholder('Fiyatını kontrol et, satın almak için seç').addOptions(items.map(item=>({label:`${item.name} · ${item.price} altın`,value:item.id}))))]:[]};
  }
  async function announce(i){
    const p=profile(i.guildId,i.user);if(p.achievement?.id!==i.id)return;
    const channelId=store.getSettings(i.guildId).rpgAnnouncementChannelId;
    try{store.addLog(i.guildId,{type:'rpg.achievement',actorId:i.user.id,message:p.achievement.text,details:{actorName:title(i.user)}});if(channelId&&client){const channel=await client.channels.fetch(channelId);if(channel?.guildId===i.guildId)await channel.send({content:`🏆 **${escapeMarkdown(title(i.user))}** ${p.achievement.text}`,allowedMentions:noMentions});}}
    catch{logger('error','rpg_announcement_failed',{guildId:i.guildId});}
  }
  async function guildUser(i,user){requireRpg(user&&!user.bot,'Bir oyuncu seç.');const member=await i.guild.members.fetch(user.id).catch(()=>null);requireRpg(member,'Oyuncu bu sunucuda bulunmuyor.');return user;}
  const option=(data,name,description,items,required=true)=>data.addStringOption(o=>o.setName(name).setDescription(description).setRequired(required).addChoices(...choices(items)));
  const monsterOption=data=>option(data,'canavar','Savaşılacak canavar',MONSTERS);
  const command=(name,description,handler,configure=data=>data)=>({
    data:configure(new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0).setIntegrationTypes(0)),
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
    command('çalış','Altın ve odun kazan. Bekleme: 30 dakika.',mutate('work')),
    command('maden','Altın, demir ve kristal kazan. Bekleme: 15 dakika.',mutate('mine')),
    command('günlük','24 saatte bir artan seri ödülünü al.',mutate('daily')),
    command('mağaza','Ekipman, kazma, balta ve iksir marketini aç.',i=>shop(i)),
    command('market','İnteraktif ekipman ve iksir marketini aç.',i=>shop(i)),
    command('satın-al','Altın karşılığında bir market eşyası al.',mutate('buy','eşya'),d=>option(d,'eşya','Satın alınacak eşya',shopItems)),
    command('savaş','d20 ile canavara meydan oku. Bekleme: 5 dakika.',mutate('battle','canavar'),monsterOption),
    command('sınıf','Seviye 10: kalıcı Savaşçı, Büyücü veya Okçu seç.',mutate('class','seçim'),d=>option(d,'seçim','Sınıf seçimi kalıcıdır',CLASSES)),
    ...CLASSES.map(c=>command(c.skill,`${c.name} yeteneği. Bekleme: 30 dakika.`,i=>act(i.guildId,i.user,'battle',{monster:i.options.getString('canavar'),skill:c.skill},i.id),monsterOption)),
    command('iksir','Can veya 30 dakikalık şans iksiri kullan.',mutate('potion','tür'),d=>option(d,'tür','Kullanılacak iksir',ITEMS.filter(i=>i.slot==='potion'))),
    command('görev','Günlük görevleri gör; tamamlanan görevin ödülünü al.',i=>{const id=i.options.getString('ödül');if(id)return act(i.guildId,i.user,'quest',id,i.id);const p=profile(i.guildId,i.user);return `**Günlük görevler · ${p.quest.date}**\n${QUESTS.map(q=>`${q.name}: **${Math.min(q.target,p.quest[q.field])}/${q.target}** · ${q.gold} altın, ${q.xp} XP${p.quest.claimed.includes(q.id)?' · Ödül alındı':''}`).join('\n')}\n/görev ödül:... ile al. İstanbul gece yarısında sıfırlanır; transfer, günlük ve bahis geliri sayılmaz.`;},d=>option(d,'ödül','Tamamlanan görevin ödülü',QUESTS,false)),
    command('üret','Tarifleri gör veya malzemelerle eşya üret.',i=>{const id=i.options.getString('tarif');return id?act(i.guildId,i.user,'craft',id,i.id):`**Üretim tarifleri**\n${RECIPES.map(r=>`**${r.name}**: ${Object.entries(r.materials).map(([id,n])=>`${n} ${MATERIAL_NAMES[id]}`).join(', ')} + ${r.gold} altın`).join('\n')}\n/üret tarif:... ile üret.`;},d=>option(d,'tarif','Üretilecek eşya',RECIPES,false)),
    command('karaborsa','Gizli tüccarın günlük saatleri ve özel eşyaları.',i=>shop(i,true)),
    command('dünya','Oyun havası, gece/gündüz ve karaborsa saatleri.',i=>{const w=world(now(),i.guildId);return `**${w.date} · Europe/Istanbul · ${w.hour}:00**\n${w.night?'Gece: madende nadir bulma +5 puan.':'Gündüz.'} ${w.weather}${w.weather==='Meteor yağmuru'?' · Nadir bulma +5 puan.':''}\nKaraborsa: ${w.openHours.map(h=>`${h}:00–${h+1}:00`).join(', ')} (${w.marketOpen?'Açık':'Kapalı'}). Oyun içi hava; gerçek hava durumu değildir.`;}),
    command('zindan','Seviye 3: boss savaşına gir veya devam et. Bekleme: 1 saat.',i=>{const p=profile(i.guildId,i.user);const content=p.fight?`Zindana devam et. Boss: **${p.fight.hp}/100** · Sen: **${p.hp}/100**`:act(i.guildId,i.user,'dungeon',null,i.id);return {content,components:fightButtons(i)};}),
    command('gönder','Bir sunucu üyesine altın veya tek bir eşya gönder.',async i=>{const target=await guildUser(i,i.options.getUser('oyuncu'));return transfer(i.guildId,i.user,target,{gold:i.options.getInteger('altın'),item:i.options.getString('eşya')},i.id);},d=>d.addUserOption(o=>o.setName('oyuncu').setDescription('Alıcı oyuncu').setRequired(true)).addIntegerOption(o=>o.setName('altın').setDescription('Gönderilecek altın (eşya ile birlikte seçme)').setMinValue(1).setMaxValue(100000)).addStringOption(o=>o.setName('eşya').setDescription('Gönderilecek tek eşya (altın ile birlikte seçme)').addChoices(...choices(ITEMS)))),
    command('düello','Onaylı PvP: iki oyuncu da seçilen altını riske eder.',async i=>{const target=await guildUser(i,i.options.getUser('oyuncu'));const content=challenge(i.guildId,i.user,target,i.options.getInteger('altın'),i.id);return {content,components:[row([[`rpg:duel:${i.id}:accept`,'Kabul et',ButtonStyle.Primary],[`rpg:duel:${i.id}:reject`,'Reddet',ButtonStyle.Danger]])]};},d=>d.addUserOption(o=>o.setName('oyuncu').setDescription('Davet edilecek rakip').setRequired(true)).addIntegerOption(o=>o.setName('altın').setDescription('Her iki tarafın riske ettiği sanal altın').setRequired(true).setMinValue(1).setMaxValue(500))),
    ...['zar-at','bahis'].map(name=>command(name,'10–500 sanal altın: d6 5–6 kazanır, 1–4 kaybeder.',i=>act(i.guildId,i.user,'gamble',i.options.getInteger('altın'),i.id),d=>d.addIntegerOption(o=>o.setName('altın').setDescription('Risk edilecek sanal altın').setRequired(true).setMinValue(10).setMaxValue(500)))),
    command('profil','Bakiye, sınıf, can, malzeme, envanter ve savaş kaydı.',i=>{const p=profile(i.guildId,i.user);return `🧙 **${escapeMarkdown(p.name)}**\nAltın: **${p.coins}** · XP: **${p.xp}** · Seviye: **${level(p.xp)}**\nSınıf: ${CLASSES.find(c=>c.id===p.classId)?.name||'Seviye 10’da /sınıf ile seç'} · Can: **${p.hp}/100**\nKılıç: ${itemById(p.sword)?.name||'Yok'} · Zırh: ${itemById(p.armor)?.name||'Yok'}\nPvE: ${p.wins} galibiyet / ${p.losses} yenilgi · PvP: ${p.pvpWins} / ${p.pvpLosses}\n**Envanter:** ${p.inventory.map(id=>itemById(id)?.name).filter(Boolean).join(', ')||'Boş'}\n**İksirler:** ${ITEMS.filter(i=>i.slot==='potion').map(i=>`${i.name}: ${p.bag[i.id]||0}`).join(' · ')}\n**Malzemeler:** ${Object.entries(MATERIAL_NAMES).map(([id,label])=>`${label}: ${p.materials[id]||0}`).join(' · ')}\nŞans etkisi: ${p.luckUntil>now()?`${Math.ceil((p.luckUntil-now())/60000)} dakika`:'Kapalı'}\n/rpg-rehber ile komutları gör.`;}),
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
      else throw new RpgError('Menü artık geçerli değil.');
      await i.editReply({content,components,allowedMentions:noMentions});await announce(i);
    }catch(error){
      const content=error instanceof RpgError?error.message:'İşlem tamamlanamadı. /profil ile kaydını kontrol edip yeniden dene.';
      if(!(error instanceof RpgError))logger('error','rpg_component_failed',{guildId:i.guildId});
      if(i.deferred||i.replied)await i.followUp({content,flags:MessageFlags.Ephemeral,allowedMentions:noMentions}).catch(()=>{});else await i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:noMentions}).catch(()=>{});
    }
  }
  return {commands,act,profile,transfer,challenge,resolveDuel,handleInteraction};
}
