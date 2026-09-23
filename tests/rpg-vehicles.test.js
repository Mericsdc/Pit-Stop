import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/store.js';
import { createRpg } from '../src/rpg.js';

const GUILD = '1400000000000000000';
const seller = { id: '1400000000000000001', username: 'Seller' };
const firstBidder = { id: '1400000000000000002', username: 'First' };
const secondBidder = { id: '1400000000000000003', username: 'Second' };

function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let time = Date.parse('2026-09-23T08:00:00+03:00');
  const rpg = createRpg(store, { now: () => time, roll: min => min });
  for (const user of [seller, firstBidder, secondBidder]) store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 20_000 });
  return { store, rpg, advance: ms => { time += ms; } };
}

test('daily customer repairs use depot parts, reward once and reset at Istanbul midnight', t => {
  const { rpg, advance } = fixture(t);
  const job = rpg.webState(GUILD, seller).vehicles.jobs[0];
  assert.equal(job.completed, false);
  assert.throws(() => rpg.act(GUILD, seller, 'jobRepair', job.id, 'missing_parts'), /parçalar yetersiz/);
  for (const [partId, count] of Object.entries(job.parts)) {
    for (let i = 0; i < count; i++) rpg.act(GUILD, seller, 'partBuy', partId, `part_${partId}_${i}`);
  }
  const before = rpg.profile(GUILD, seller).coins;
  assert.match(rpg.act(GUILD, seller, 'jobRepair', job.id, 'job_claim'), /tamir edildi/);
  assert.equal(rpg.profile(GUILD, seller).coins, before + job.reward);
  assert.equal(rpg.webState(GUILD, seller).vehicles.jobs[0].completed, true);
  assert.deepEqual(rpg.webState(GUILD, seller).vehicles.recentJob, { modelId: job.modelId, completedAt: Date.parse('2026-09-23T08:00:00+03:00') });
  assert.throws(() => rpg.act(GUILD, seller, 'jobRepair', job.id, 'job_again'), /zaten tamir/);
  advance(16 * 60 * 60_000);
  assert.equal(rpg.webState(GUILD, seller).vehicles.jobs[0].completed, false);
});

test('car repair and auction share PitCoin, refund outbid player and settle exactly once', t => {
  const { rpg, store, advance } = fixture(t);
  rpg.act(GUILD, seller, 'carBuy', 'compact', 'car_buy');
  const car = rpg.webState(GUILD, seller).vehicles.vehicles[0];
  assert.equal(car.status, 'broken');
  assert.throws(() => rpg.listVehicle(GUILD, seller, car.id, 'early_list'), /tamir edilmiş/);
  rpg.act(GUILD, seller, 'partBuy', 'filter', 'filter_buy');
  rpg.act(GUILD, seller, 'partBuy', 'brake', 'brake_buy');
  rpg.act(GUILD, seller, 'carRepair', car.id, 'car_repair');
  assert.equal(rpg.webState(GUILD, seller).vehicles.vehicles[0].status, 'repaired');
  rpg.listVehicle(GUILD, seller, car.id, 'auction_list');
  assert.equal(rpg.webState(GUILD, seller).vehicles.vehicles.length, 0);
  const auction = rpg.auctions(GUILD)[0];
  assert.equal(auction.status, 'open');
  assert.throws(() => rpg.bidVehicle(GUILD, seller, auction.id, auction.currentBid + 50, 'self_bid'), /Kendi aracına/);
  const firstBalance = rpg.profile(GUILD, firstBidder).coins;
  rpg.bidVehicle(GUILD, firstBidder, auction.id, auction.currentBid + 50, 'first_bid');
  assert.throws(() => rpg.bidVehicle(GUILD, firstBidder, auction.id, auction.currentBid + 50, 'first_bid'), /zaten işlendi/);
  const secondAmount = auction.currentBid + 100;
  rpg.bidVehicle(GUILD, secondBidder, auction.id, secondAmount, 'second_bid');
  assert.equal(rpg.profile(GUILD, firstBidder).coins, firstBalance);
  assert.equal(rpg.profile(GUILD, secondBidder).coins, 20_000 - secondAmount);
  const sellerBefore = rpg.profile(GUILD, seller).coins;
  advance(30 * 60_000);
  const settled = rpg.webState(GUILD, seller);
  assert.equal(settled.auctions[0].status, 'sold');
  assert.equal(rpg.profile(GUILD, seller).coins, sellerBefore + settled.auctions[0].currentBid);
  if (settled.auctions[0].winnerId === secondBidder.id) assert.equal(rpg.webState(GUILD, secondBidder).vehicles.vehicles[0].id, car.id);
  else assert.equal(rpg.profile(GUILD, secondBidder).coins, 20_000);
  rpg.webState(GUILD, seller);
  assert.equal(rpg.profile(GUILD, seller).coins, sellerBefore + settled.auctions[0].currentBid);
  assert.equal(store.listRecords(GUILD, 'rpg_transaction').filter(entry => entry.type === 'vehicleAuctionSold').length, 1);
});

test('NPC bidders advance a timed auction and keep vehicles guild scoped', t => {
  const { rpg, advance } = fixture(t);
  rpg.act(GUILD, seller, 'carBuy', 'compact', 'npc_buy');
  const car = rpg.webState(GUILD, seller).vehicles.vehicles[0];
  rpg.act(GUILD, seller, 'partBuy', 'filter', 'npc_filter');
  rpg.act(GUILD, seller, 'partBuy', 'brake', 'npc_brake');
  rpg.act(GUILD, seller, 'carRepair', car.id, 'npc_repair');
  rpg.listVehicle(GUILD, seller, car.id, 'npc_list');
  const auction = rpg.auctions(GUILD)[0], before = rpg.profile(GUILD, seller).coins;
  assert.equal(rpg.auctions('1400000000000000999').length, 0);
  advance(30 * 60_000);
  assert.equal(rpg.auctions(GUILD)[0].status, 'sold');
  const settled = rpg.auctions(GUILD)[0];
  assert.ok(settled.currentBid >= auction.openingBid);
  assert.ok(settled.currentBid <= Math.floor(auction.openingBid * 2.1));
  assert.equal(rpg.profile(GUILD, seller).coins, before + settled.currentBid);
});

test('loot boxes, junkyard salvage and car mods share the server-side depot', t => {
  const { rpg, store } = fixture(t);
  const saved = rpg.profile(GUILD, seller);
  saved.garage.xp = 3_800;
  store.putRecord(GUILD, 'rpg_player', seller.id, saved);
  rpg.act(GUILD, seller, 'carBuy', 'compact', 'custom_car');
  const car = rpg.webState(GUILD, seller).vehicles.vehicles[0];
  for (const id of ['filter', 'brake', 'alloy-wheel']) rpg.act(GUILD, seller, 'partBuy', id, `custom_${id}`);
  rpg.act(GUILD, seller, 'carRepair', car.id, 'custom_repair');
  const original = rpg.webState(GUILD, seller).vehicles.vehicles[0];
  assert.match(rpg.act(GUILD, seller, 'modApply', { carId: car.id, modId: 'wheels' }, 'custom_mod'), /kuruldu/u);
  const modified = rpg.webState(GUILD, seller).vehicles.vehicles[0];
  assert.ok(modified.raceScore > original.raceScore);
  assert.ok(modified.openingBid > original.openingBid);
  assert.throws(() => rpg.act(GUILD, seller, 'modApply', { carId: car.id, modId: 'wheels' }, 'custom_mod_again'), /depoda yok|zaten takılı/u);
  assert.match(rpg.act(GUILD, seller, 'boxBuy', 'legendary', 'legendary_box'), /çıktı/u);
  assert.match(rpg.act(GUILD, seller, 'junkyardSearch', null, 'junkyard_find'), /buldun/u);
  const junk = rpg.webState(GUILD, seller).vehicles.vehicles.find(item => item.source === 'junkyard');
  assert.ok(junk);
  assert.match(rpg.act(GUILD, seller, 'carSalvage', junk.id, 'junkyard_salvage'), /parçalarına ayrıldı/u);
  assert.equal(rpg.webState(GUILD, seller).vehicles.vehicles.some(item => item.id === junk.id), false);
});

test('an open SOS can be claimed by only one equipped player', t => {
  const { rpg, store } = fixture(t);
  const first = rpg.profile(GUILD, firstBidder), second = rpg.profile(GUILD, secondBidder);
  for (const player of [first, second]) {
    player.garage.xp = 1_400;
    player.garage.owned.push('ikinci-el-cekici');
    player.garage.equipped.tow = 'ikinci-el-cekici';
  }
  store.putRecord(GUILD, 'rpg_player', firstBidder.id, first);
  store.putRecord(GUILD, 'rpg_player', secondBidder.id, second);
  const time = Date.parse('2026-09-23T08:00:00+03:00');
  store.putRecord(GUILD, 'rpg_roadside_call', 'current', { callId: 'sos-1', status: 'open', openUntil: time + 60_000, nextAt: time + 3_600_000 });
  assert.match(rpg.act(GUILD, firstBidder, 'roadside', null, 'sos_first'), /ilk sen aldın/u);
  assert.throws(() => rpg.act(GUILD, secondBidder, 'roadside', null, 'sos_second'), /başka bir oyuncu/u);
  assert.equal(store.getRecord(GUILD, 'rpg_roadside_call', 'current').claimedBy, firstBidder.id);
});
