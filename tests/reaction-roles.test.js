import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { createReactionRoleHandler } from '../src/reaction-roles.js';
import { createStore } from '../src/store.js';

const GUILD = '1400000000000000000';
const MESSAGE = '1400000000000000001';
const CHANNEL = '1400000000000000002';
const USER = '1400000000000000003';
const ROLE = '1400000000000000004';

test('reaction add assigns the mapped role and reaction removal takes it back', async t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  store.putRecord(GUILD, 'reaction_role', MESSAGE, { channelId: CHANNEL, mappings: [{ key: 'unicode:🏁', label: '🏁', roleId: ROLE, roleName: 'Yarışçı' }] });
  const changes = [];
  const role = { id: ROLE, name: 'Yarışçı', editable: true, managed: false };
  const cache = new Collection();
  const member = { roles: { cache, add: async added => { changes.push(['add', added.id]); cache.set(added.id, added); }, remove: async removed => { changes.push(['remove', removed.id]); cache.delete(removed.id); } } };
  const guild = {
    id: GUILD,
    members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles) }, fetch: async id => { assert.equal(id, USER); return member; } },
    roles: { cache: new Collection([[ROLE, role]]), fetch: async id => id === ROLE ? role : null },
  };
  const reaction = { emoji: { id: null, name: '🏁' }, message: { id: MESSAGE, channelId: CHANNEL, guildId: GUILD, guild } };
  const user = { id: USER, username: 'pilot', globalName: 'Pilot', bot: false };
  const handle = createReactionRoleHandler(store);

  assert.equal(await handle(reaction, user, 'add'), true);
  assert.equal(await handle(reaction, user, 'remove'), true);
  assert.deepEqual(changes, [['add', ROLE], ['remove', ROLE]]);
  assert.deepEqual(store.getLogs(GUILD, { limit: 10 }).map(log => log.type), ['reaction_role.removed', 'reaction_role.assigned']);
});

test('unmapped reactions and bot reactions do not change roles', async t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  store.putRecord(GUILD, 'reaction_role', MESSAGE, { channelId: CHANNEL, mappings: [{ key: 'unicode:✅', label: '✅', roleId: ROLE, roleName: 'Üye' }] });
  let fetched = 0;
  const guild = { id: GUILD, members: { fetch: async () => { fetched += 1; } } };
  const handle = createReactionRoleHandler(store);
  assert.equal(await handle({ emoji: { name: '❌' }, message: { id: MESSAGE, guild } }, { id: USER, bot: false }, 'add'), false);
  assert.equal(await handle({ emoji: { name: '✅' }, message: { id: MESSAGE, guild } }, { id: USER, bot: true }, 'add'), false);
  assert.equal(fetched, 0);
});
