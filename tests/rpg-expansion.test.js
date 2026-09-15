import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/store.js';
import { createRpg } from '../src/rpg.js';
import { DAY, LIMIT, world, dateKey, CLASSES } from '../src/rpg-system.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const G='1400000000000000000',OTHER='1400000000000000009';
const a={id:'1400000000000000001',username:'Pilot'},b={id:'1400000000000000002',username:'Rival'};
function setup(t,options={}){
  const store=createStore(':memory:');t.after(()=>store.close());
  let time=Date.UTC(2026,8,15,9),r=(min)=>min;
  const rpg=createRpg(store,{now:()=>time,roll:(...args)=>r(...args),...options});
  const seed=(user,patch)=>store.putRecord(G,'rpg_player',user.id,{...rpg.profile(G,user),...patch});
  return {store,rpg,seed,advance:ms=>{time+=ms;},setTime:value=>{time=value;},getTime:()=>time,setRoll:fn=>{r=fn;}};
}
test('legacy players retain balances, equipment and cooldowns while new fields are initialized',t=>{
  const {store,rpg}=setup(t);store.putRecord(G,'rpg_player',a.id,{name:'Old',coins:321,xp:99,wins:2,losses:1,inventory:['demir-kilic'],sword:'demir-kilic',armor:null,cooldowns:{work:9999999999999},receipts:[]});
  const p=rpg.profile(G,a);assert.equal(p.coins,321);assert.equal(p.sword,'demir-kilic');assert.equal(p.hp,100);assert.deepEqual(p.materials,{});assert.throws(()=>rpg.act(G,a,'work'),/beklemelisin/);
});
test('class gate is level 10, selection is permanent and wrong-class skills cannot change state',t=>{
  const {rpg,seed,store,advance}=setup(t);seed(a,{xp:8099});assert.throws(()=>rpg.act(G,a,'class','savasci'),/Seviye 10/);
  seed(a,{xp:8100});rpg.act(G,a,'class','savasci');assert.throws(()=>rpg.act(G,a,'class','buyucu'),/zaten/);
  const before=store.getRecord(G,'rpg_player',a.id);assert.throws(()=>rpg.act(G,a,'battle',{monster:'goblin',skill:'nişan'}),/sınıfa ait değil/);assert.deepEqual(store.getRecord(G,'rpg_player',a.id),before);
  assert.match(rpg.act(G,a,'battle',{monster:'goblin',skill:'öfke'}),/yetenek 7/);advance(300000);assert.throws(()=>rpg.act(G,a,'battle',{monster:'goblin',skill:'öfke'}),/30 dakikalık/);
});
test('daily reward enforces 24h, caps streak and resets after missed 48h',t=>{
  const {rpg,advance}=setup(t);rpg.act(G,a,'daily');assert.equal(rpg.profile(G,a).coins,100);advance(DAY-1);assert.throws(()=>rpg.act(G,a,'daily'),/beklemelisin/);advance(1);
  rpg.act(G,a,'daily');assert.equal(rpg.profile(G,a).coins,225);
  for(let n=0;n<9;n++){advance(DAY);rpg.act(G,a,'daily');}assert.equal(rpg.profile(G,a).daily.streak,7);
  advance(2*DAY+1);rpg.act(G,a,'daily');assert.equal(rpg.profile(G,a).daily.streak,1);assert.equal(rpg.profile(G,a).quest.earned,0);
});
test('gold transfer is atomic, guild scoped, bounded and idempotent',t=>{
  const {rpg,seed,store}=setup(t);seed(a,{coins:100});rpg.transfer(G,a,b,{gold:70},'t1');assert.equal(rpg.profile(G,a).coins,30);assert.equal(rpg.profile(G,b).coins,70);
  assert.throws(()=>rpg.transfer(G,a,b,{gold:70},'t1'),/zaten/);assert.throws(()=>rpg.transfer(G,a,b,{gold:40},'t2'),/yetmiyor/);assert.equal(store.getRecord(G,'rpg_transfer','t2'),null);
  assert.equal(rpg.profile(OTHER,b).coins,0);for(const gold of [-1,NaN,1.5,100001])assert.throws(()=>rpg.transfer(G,a,b,{gold},'bad'));
  assert.throws(()=>rpg.transfer(G,a,a,{gold:1},'self'));assert.throws(()=>rpg.transfer(G,a,{...b,bot:true},{gold:1},'bot'));assert.throws(()=>rpg.transfer(G,a,b,{gold:1,item:'demir-kilic'},'both'));
  seed(b,{coins:LIMIT});assert.throws(()=>rpg.transfer(G,a,b,{gold:1},'overflow'),/sınır/);assert.equal(rpg.profile(G,a).coins,30);
});
test('item transfer reevaluates equipped items and duplicate rejection preserves both inventories',t=>{
  const {rpg,seed}=setup(t);seed(a,{inventory:['demir-kilic','celik-kilic'],sword:'celik-kilic'});
  rpg.transfer(G,a,b,{item:'celik-kilic'},'item1');assert.equal(rpg.profile(G,a).sword,'demir-kilic');assert.equal(rpg.profile(G,b).sword,'celik-kilic');
  seed(a,{inventory:['demir-kilic','celik-kilic'],sword:'celik-kilic'});assert.throws(()=>rpg.transfer(G,a,b,{item:'celik-kilic'},'item2'),/zaten/);assert.ok(rpg.profile(G,a).inventory.includes('celik-kilic'));
  seed(a,{bag:{'can-iksiri':2}});rpg.transfer(G,a,b,{item:'can-iksiri'},'potion1');assert.equal(rpg.profile(G,a).bag['can-iksiri'],1);assert.equal(rpg.profile(G,b).bag['can-iksiri'],1);
});
test('duels require target consent and fresh balance; settlement transfers once without creating money',t=>{
  const {rpg,seed,advance}=setup(t);seed(a,{coins:300,xp:8100});seed(b,{coins:300});rpg.challenge(G,a,b,100,'d1');
  assert.throws(()=>rpg.resolveDuel(G,a,'d1',true),/yalnızca/);assert.equal(rpg.profile(G,b).coins,300);
  rpg.resolveDuel(G,b,'d1',true);assert.equal(rpg.profile(G,a).coins,400);assert.equal(rpg.profile(G,b).coins,200);assert.equal(rpg.profile(G,a).pvpWins,1);assert.throws(()=>rpg.resolveDuel(G,b,'d1',true),/sona ermiş/);
  assert.throws(()=>rpg.challenge(G,a,b,100,'d2'),/bekleme/);advance(600000);rpg.challenge(G,a,b,100,'d2');seed(b,{coins:0});assert.throws(()=>rpg.resolveDuel(G,b,'d2',true),/yeterli altını/);assert.equal(rpg.profile(G,a).coins,400);
});
test('duel expiry and decline do not move gold; tied dice do not create gold',t=>{
  const {rpg,seed,advance}=setup(t);seed(a,{coins:100});seed(b,{coins:100});rpg.challenge(G,a,b,10,'expired');advance(120000);assert.throws(()=>rpg.resolveDuel(G,b,'expired',true),/sona ermiş/);
  rpg.challenge(G,a,b,10,'decline');rpg.resolveDuel(G,b,'decline',false);assert.equal(rpg.profile(G,a).coins,100);rpg.challenge(G,a,b,10,'tie');assert.match(rpg.resolveDuel(G,b,'tie',true),/Berabere/);assert.equal(rpg.profile(G,b).coins,100);
});
test('gathering tools increase income and materials without consuming equipment',t=>{
  const {rpg,seed}=setup(t);seed(a,{pickaxe:'elmas-kazma',axe:'celik-balta',inventory:['elmas-kazma','celik-balta']});rpg.act(G,a,'work');rpg.act(G,a,'mine');const p=rpg.profile(G,a);assert.equal(p.coins,200);assert.equal(p.materials.iron,1);assert.equal(p.materials.wood,1);assert.equal(p.materials.crystal,1);
});
test('potions consume once; full health and active luck reject without spending',t=>{
  const {rpg,seed,advance}=setup(t);seed(a,{hp:20,bag:{'can-iksiri':3,'sans-iksiri':2}});rpg.act(G,a,'potion','can-iksiri');assert.equal(rpg.profile(G,a).hp,70);rpg.act(G,a,'potion','can-iksiri');assert.throws(()=>rpg.act(G,a,'potion','can-iksiri'),/zaten dolu/);assert.equal(rpg.profile(G,a).bag['can-iksiri'],1);
  rpg.act(G,a,'potion','sans-iksiri');assert.throws(()=>rpg.act(G,a,'potion','sans-iksiri'),/zaten etkin/);assert.equal(rpg.profile(G,a).bag['sans-iksiri'],1);advance(1800000);rpg.act(G,a,'potion','sans-iksiri');assert.equal(rpg.profile(G,a).bag['sans-iksiri'],0);
});
test('crafting spends materials and gold atomically; duplicate and missing ingredients rollback',t=>{
  const {rpg,seed,store}=setup(t);seed(a,{coins:2000,materials:{iron:30,crystal:8,fragment:3}});rpg.act(G,a,'craft','ejder-kilic');assert.equal(rpg.profile(G,a).sword,'ejder-kilic');assert.equal(rpg.profile(G,a).coins,1000);assert.equal(rpg.profile(G,a).materials.iron,0);
  const before=store.getRecord(G,'rpg_player',a.id);assert.throws(()=>rpg.act(G,a,'craft','ejder-zirh'),/yetersiz/);assert.deepEqual(store.getRecord(G,'rpg_player',a.id),before);
  seed(a,{materials:{iron:30,crystal:8,fragment:3}});assert.throws(()=>rpg.act(G,a,'craft','ejder-kilic'),/zaten/);assert.equal(rpg.profile(G,a).materials.iron,30);
});
test('quests award once and reset at Istanbul midnight; reward money does not count itself',t=>{
  const {rpg,seed,setTime,advance}=setup(t);setTime(Date.UTC(2026,8,15,20,59,59));seed(a,{quest:{date:'2026-09-15',earned:500,goblins:3,claimed:[]}});rpg.act(G,a,'quest','altin');assert.equal(rpg.profile(G,a).coins,200);assert.equal(rpg.profile(G,a).quest.earned,500);assert.throws(()=>rpg.act(G,a,'quest','altin'),/bugün aldın/);rpg.act(G,a,'quest','goblin');advance(1000);assert.equal(rpg.profile(G,a).quest.date,'2026-09-16');assert.equal(rpg.profile(G,a).quest.earned,0);assert.throws(()=>rpg.act(G,a,'quest','goblin'),/tamamlanmadı/);
});
test('world stays deterministic, nights affect gathering and blackmarket gates special items',t=>{
  const {rpg,seed,setTime,getTime}=setup(t);const w=world(getTime(),G);assert.deepEqual(world(getTime(),G),w);assert.equal(w.openHours.length,2);assert.equal(new Set(w.openHours).size,2);
  seed(a,{coins:10000});const closed=Array.from({length:24},(_,n)=>n).find(n=>!w.openHours.includes(n));setTime(Date.UTC(2026,8,15,closed-3));assert.throws(()=>rpg.act(G,a,'buy','lanetli-kilic'),/kapalı/);
  setTime(Date.UTC(2026,8,15,w.openHours[0]-3));rpg.act(G,a,'buy','lanetli-kilic');assert.equal(rpg.profile(G,a).coins,5000);assert.throws(()=>rpg.act(G,a,'buy','boss-kilic'),/bulunamadı/);
  assert.equal(world(Date.UTC(2026,8,15,18),G).night,true);assert.equal(dateKey(Date.UTC(2026,8,15,21)),'2026-09-16');
});
test('gamble validates bounds, shares cooldown across aliases and never goes negative',t=>{
  const {rpg,seed,advance,setRoll}=setup(t);seed(a,{coins:100});for(const amount of [0,-10,501,1.2])assert.throws(()=>rpg.act(G,a,'gamble',amount));rpg.act(G,a,'gamble',100);assert.equal(rpg.profile(G,a).coins,0);assert.throws(()=>rpg.act(G,a,'gamble',10),/beklemelisin/);advance(60000);assert.throws(()=>rpg.act(G,a,'gamble',10),/yetmiyor/);seed(a,{coins:100});setRoll(()=>6);rpg.act(G,a,'gamble',100);assert.equal(rpg.profile(G,a).coins,200);assert.equal(rpg.profile(G,a).quest.earned,0);
});
test('dungeon turns are versioned, rewards settle once and fleeing preserves cooldown',t=>{
  const {rpg,seed}=setup(t);seed(a,{xp:8100,sword:'ejder-kilic',armor:'ejder-zirh',inventory:['ejder-kilic','ejder-zirh']});rpg.act(G,a,'dungeon',null,'boss');
  rpg.act(G,a,'dungeonTurn',{id:'boss',turn:0,move:'attack'},'turn0');const after=rpg.profile(G,a);assert.throws(()=>rpg.act(G,a,'dungeonTurn',{id:'boss',turn:0,move:'attack'},'duplicate'),/eskimiş/);assert.equal(rpg.profile(G,a).fight.hp,after.fight.hp);
  for(let turn=1;rpg.profile(G,a).fight;turn++)rpg.act(G,a,'dungeonTurn',{id:'boss',turn,move:'attack'},`turn${turn}`);
  assert.equal(rpg.profile(G,a).coins,600);assert.equal(rpg.profile(G,a).materials.fragment,1);assert.ok(rpg.profile(G,a).inventory.includes('boss-kilic'));assert.throws(()=>rpg.act(G,a,'dungeonTurn',{id:'boss',turn:4,move:'attack'}),/eskimiş/);assert.throws(()=>rpg.act(G,a,'dungeon'),/beklemelisin/);
});
test('dungeon rejects outsider buttons, expired battles, healing without potions and transfers midfight',async t=>{
  const {rpg,seed,advance}=setup(t);seed(a,{xp:400,coins:100});rpg.act(G,a,'dungeon',null,'boss');assert.throws(()=>rpg.act(G,a,'dungeonTurn',{id:'boss',turn:0,move:'heal'}),/envanterinde yok/);assert.equal(rpg.profile(G,a).fight.turn,0);
  assert.throws(()=>rpg.transfer(G,a,b,{gold:10},'locked'),/Zindandaki/);let reply;await rpg.handleInteraction({customId:`rpg:fight:${a.id}:boss:0:attack`,id:'stranger',user:b,guildId:G,inGuild:()=>true,isButton:()=>true,reply:async p=>{reply=p;}});assert.match(reply.content,/başka bir oyuncuya/);assert.equal(rpg.profile(G,a).fight.turn,0);
  advance(900000);assert.equal(rpg.profile(G,a).fight,null);assert.throws(()=>rpg.act(G,a,'dungeonTurn',{id:'boss',turn:0,move:'attack'}),/eskimiş/);
});
test('all three skills, market menus, fight buttons and guide fit Discord limits',async t=>{
  const {rpg,seed}=setup(t);seed(a,{xp:8100});
  for(const name of ['rpg-rehber','market','karaborsa','profil','üret','görev','dünya','zindan']){
    let response;await rpg.commands.find(c=>c.data.name===name).execute({id:`cmd-${name}`,user:a,guildId:G,inGuild:()=>true,options:{getString:()=>null},deferReply:async()=>{},editReply:async p=>{response=p;}});
    assert.ok(response.content.length<=2000,`${name} length ${response.content.length}`);
    for(const row of response.components||[]){const json=row.toJSON();for(const c of json.components){assert.ok(c.custom_id.length<=100);if(c.options)assert.ok(c.options.length<=25);}}
  }
  for(const c of CLASSES)assert.ok(rpg.commands.some(cmd=>cmd.data.name===c.skill));
});
test('RPG announcement settings persist and boss celebrations use only the selected guild channel',async t=>{
  const sent=[],channel='1400000000000000003';
  const {rpg,store,seed}=setup(t,{client:{channels:{fetch:async id=>({guildId:G,send:async payload=>sent.push({id,payload})})}}});
  store.updateSettings(G,{rpgAnnouncementChannelId:channel});seed(a,{coins:2000,materials:{iron:30,crystal:8,fragment:3}});
  await rpg.commands.find(c=>c.data.name==='üret').execute({id:'craft-notify',user:a,guildId:G,inGuild:()=>true,options:{getString:()=> 'ejder-kilic'},deferReply:async()=>{},editReply:async()=>{}});
  assert.equal(sent.length,1);assert.equal(sent[0].id,channel);assert.deepEqual(sent[0].payload.allowedMentions,{parse:[]});assert.equal(store.getLogs(G,{type:'rpg.achievement'}).length,1);
});
test('expanded records and pending dungeon survive restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pitstop-rpg-v2-'));let store;
  try{const path=join(dir,'rpg.sqlite');store=createStore(path);const rpg=createRpg(store);store.putRecord(G,'rpg_player',a.id,{...rpg.profile(G,a),xp:8100,coins:1000,classId:'buyucu',bag:{'can-iksiri':3}});rpg.act(G,a,'daily');rpg.act(G,a,'dungeon',null,'persistent');store.close();store=createStore(path);const p=createRpg(store).profile(G,a);assert.equal(p.classId,'buyucu');assert.equal(p.bag['can-iksiri'],3);assert.equal(p.fight.id,'persistent');assert.equal(p.daily.streak,1);}finally{store?.close();rmSync(dir,{recursive:true});}
});

test('owned market and dungeon buttons execute; rapid duplicate turns do not double damage',async t=>{
  const {rpg,seed}=setup(t);seed(a,{xp:8100,coins:1000});let output,errors=[];
  const interaction=(id,customId,values)=>({id,customId,values,user:a,guildId:G,inGuild:()=>true,isButton:()=>!values,isStringSelectMenu:()=>Boolean(values),deferred:true,deferUpdate:async()=>{},editReply:async p=>{output=p;},followUp:async p=>errors.push(p.content)});
  await rpg.handleInteraction(interaction('buy1',`rpg:shop:${a.id}`,['can-iksiri']));assert.equal(rpg.profile(G,a).coins,920);assert.equal(rpg.profile(G,a).bag['can-iksiri'],1);
  await rpg.handleInteraction(interaction('buy1',`rpg:shop:${a.id}`,['can-iksiri']));assert.equal(rpg.profile(G,a).coins,920);assert.match(errors[0],/zaten/);
  rpg.act(G,a,'dungeon',null,'fight1');const custom=`rpg:fight:${a.id}:fight1:0:attack`;
  await Promise.all([rpg.handleInteraction(interaction('click1',custom)),rpg.handleInteraction(interaction('click2',custom))]);assert.equal(rpg.profile(G,a).fight.turn,1);assert.ok(errors.some(message=>message.includes('eskimiş')));assert.equal(output.components.length,1);
  await rpg.handleInteraction(interaction('flee',`rpg:fight:${a.id}:fight1:1:flee`));assert.equal(rpg.profile(G,a).fight,null);assert.equal(output.components.length,0);assert.throws(()=>rpg.act(G,a,'dungeon'),/beklemelisin/);
});
