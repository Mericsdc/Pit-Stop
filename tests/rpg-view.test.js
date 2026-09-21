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
