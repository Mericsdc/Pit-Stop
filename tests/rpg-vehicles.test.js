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
  assert.equal(rpg.profile(GUILD, seller).coins, sellerBefore + secondAmount);
  assert.equal(rpg.webState(GUILD, secondBidder).vehicles.vehicles[0].id, car.id);
  rpg.webState(GUILD, seller);
  assert.equal(rpg.profile(GUILD, seller).coins, sellerBefore + secondAmount);
  assert.equal(store.listRecords(GUILD, 'rpg_transaction').filter(entry => entry.type === 'vehicleAuctionSold').length, 1);
});

test('unbid auction completes with server opening offer and keeps vehicles guild scoped', t => {
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
  assert.equal(rpg.profile(GUILD, seller).coins, before + auction.openingBid);
});
