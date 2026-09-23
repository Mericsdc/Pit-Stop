import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/store.js';
import { createRpg } from '../src/rpg.js';
import { renderRpgContent } from '../public/rpg-view.js';

const GUILD = '1400000000000000000';
const user = { id: '1400000000000000001', username: 'LUREXA' };
const helpers = {
  escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  number: value => Number(value || 0).toLocaleString('tr-TR'),
  date: value => String(value),
  empty: value => `<p>${value}</p>`,
};

test('RPG view uses raw timestamps, separate crafting screen and no duplicate profile HUD', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let time = 1_800_000;
  const rpg = createRpg(store, { now: () => time, roll: min => min });
  store.putRecord(GUILD, 'rpg_player', user.id, { ...rpg.profile(GUILD, user), coins: 1000 });
  rpg.act(GUILD, user, 'buy', 'demir-kilic', 'buy_for_view');
  rpg.startActivity(GUILD, user, 'mine', 'mine_for_view');
  const state = rpg.webState(GUILD, user);

  const home = renderRpgContent(state, helpers, 'home');
  assert.match(home, /data-rpg-section="crafting"/);
  assert.match(home, /data-rpg-action="sell"/);
  assert.match(home, /125 altına sat/);
  assert.match(home, new RegExp(`data-ends-at="${state.activity.endsAt}"`));
  assert.doesNotMatch(home, /NaN/);

  const crafting = renderRpgContent(state, helpers, 'crafting');
  assert.match(crafting, /Zanaat tarifleri/);
  assert.match(crafting, /Boss parçası/);
  const profile = renderRpgContent(state, helpers, 'profile');
  assert.doesNotMatch(profile, /<header class="rpg-hud">/);
  assert.match(profile, /OYUNCU PROFİLİ/);
});

test('boss outcome stays visible inside the RPG screen after the fight ends', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const state = createRpg(store).webState(GUILD, user);
  const html = renderRpgContent(state, helpers, 'dungeon', { tone: 'success', message: '🏆 Boss yenildi! +600 altın · +250 XP.' });
  assert.match(html, /class="rpg-result success"/u);
  assert.match(html, /Boss yenildi!/u);
  assert.match(html, /data-rpg-dismiss-result/u);
});

test('quests show difficulty groups, daily timer and three dungeon levels', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const state = createRpg(store).webState(GUILD, user);
  const quests = renderRpgContent(state, helpers, 'quests');
  assert.match(quests, /Kolay GÖREV/u);
  assert.match(quests, /Orta GÖREV/u);
  assert.match(quests, /Zor GÖREV/u);
  assert.match(quests, /data-rpg-daily-countdown/u);
  const dungeon = renderRpgContent(state, helpers, 'dungeon');
  for (const difficulty of ['kolay', 'orta', 'zor']) assert.match(dungeon, new RegExp(`data-difficulty="${difficulty}"`));
  assert.match(dungeon, /Saf Işığın Muhafızı ekipmanları/u);
});

test('garage links to the vehicle dashboard with daily jobs, depot and auction controls', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const state = createRpg(store).webState(GUILD, user);
  const html = renderRpgContent(state, helpers, 'vehicles');
  assert.match(html, /data-rpg-section="vehicles"/u);
  assert.match(html, /rpg-garage-vehicles-link/u);
  assert.match(html, /data-rpg-screen="vehicles"/u);
  assert.match(html, /GÜNLÜK TAMİR İŞLERİ/u);
  assert.match(html, /PARÇA DEPOSU/u);
  assert.match(html, /data-rpg-action="part-buy"/u);
  assert.match(html, /data-rpg-action="job-repair"/u);
  assert.match(html, /rpg-garage-isometric/u);
  assert.match(html, /rpg-garage-interactive/u);
  assert.match(html, /data-rpg-scene-bay="0"/u);
  assert.match(html, /MODİFİYE VE TASARIM ATÖLYESİ/u);
  assert.match(html, /data-rpg-action="box-buy"/u);
  assert.match(html, /data-rpg-action="junkyard-search"/u);
  assert.doesNotMatch(html, /NaN/u);
});
