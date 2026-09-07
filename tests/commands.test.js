import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApplicationIntegrationType,
  ChannelType,
  Collection,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { commands } from '../src/commands.js';

const byName = new Map(commands.map((command) => [command.data.name, command]));
const deletePermissions = PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ReadMessageHistory;
const allPermissions = deletePermissions | PermissionFlagsBits.SendPolls;

function interaction(values = {}, overrides = {}) {
  const calls = { replies: [], edits: [], defers: [], fetches: [], deletes: [] };
  const result = {
    id: '1500000000000000000',
    guildId: '1400000000000000000',
    createdTimestamp: Date.now(),
    inGuild: () => true,
    memberPermissions: new PermissionsBitField(allPermissions),
    appPermissions: new PermissionsBitField(allPermissions),
    options: {
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getBoolean: (name) => values[name] ?? null,
      getUser: (name) => values[name] ?? null,
    },
    user: { displayName: 'Pilot', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    client: { ws: { ping: 40 } },
    channel: {
      type: ChannelType.GuildText,
      messages: {
        fetch: async (options) => {
          calls.fetches.push(options);
          return new Collection();
        },
      },
      bulkDelete: async (messages, filterOld) => {
        calls.deletes.push({ messages, filterOld });
        return messages;
      },
    },
    reply: async (payload) => { calls.replies.push(payload); },
    editReply: async (payload) => { calls.edits.push(payload); },
    deferReply: async (payload) => { calls.defers.push(payload); },
    ...overrides,
  };
  return { result, calls };
}

function description(payload) {
  return payload.embeds[0].toJSON().description;
}

function message(id, overrides = {}) {
  return {
    id,
    pinned: false,
    system: false,
    deletable: true,
    createdTimestamp: Date.now() - 60_000,
    ...overrides,
  };
}

test('all seven command payloads serialize with guild-only installation and context', () => {
  assert.deepEqual([...byName.keys()], ['yardim', 'ping', 'sunucu', 'avatar', 'anket', 'temizle', 'clear']);
  for (const { data, execute } of commands) {
    const payload = data.toJSON();
    assert.deepEqual(payload.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(payload.integration_types, [ApplicationIntegrationType.GuildInstall]);
    assert.equal(typeof execute, 'function');
  }
  const cleanup = byName.get('temizle').data.toJSON();
  assert.equal(cleanup.default_member_permissions, deletePermissions.toString());
  assert.equal(cleanup.options[0].min_value, 1);
  assert.equal(cleanup.options[0].max_value, 100);
  const poll = byName.get('anket').data.toJSON();
  assert.equal(poll.default_member_permissions, PermissionFlagsBits.SendPolls.toString());
  assert.equal(poll.options.find(({ name }) => name === 'soru').max_length, 300);
});

test('clear aliases the guarded cleanup behavior', async () => {
  const { result, calls } = interaction({ adet: 1 }, { memberPermissions: new PermissionsBitField(0n) });
  await byName.get('clear').execute(result);
  assert.equal(calls.deletes.length, 0);
  assert.equal(calls.fetches.length, 0);
  assert.match(description(calls.replies[0]), /Mesajları Yönet/u);
});

test('all commands reject direct messages before doing work', async () => {
  for (const command of commands) {
    const { result, calls } = interaction({}, { inGuild: () => false });
    await command.execute(result);
    assert.equal(calls.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(description(calls.replies[0]), /sunucusunda/u);
    assert.equal(calls.fetches.length, 0);
  }
});

test('poll creates a native Discord poll with trimmed options and defaults', async () => {
  const { result, calls } = interaction({ soru: '  Ne yapalım? ', secenekler: ' Yarış | Sohbet ' });
  await byName.get('anket').execute(result);
  assert.deepEqual(calls.replies[0].poll, {
    question: { text: 'Ne yapalım?' },
    answers: [{ text: 'Yarış' }, { text: 'Sohbet' }],
    duration: 24,
    allowMultiselect: false,
  });
  assert.equal(calls.replies[0].flags, undefined);
});

test('poll accepts ten answers and explicit duration and multiple selections', async () => {
  const { result, calls } = interaction({
    soru: 'Seç', secenekler: Array.from({ length: 10 }, (_, index) => `Seçenek ${index}`).join('|'),
    sure: 768, coklu: true,
  });
  await byName.get('anket').execute(result);
  assert.equal(calls.replies[0].poll.answers.length, 10);
  assert.equal(calls.replies[0].poll.duration, 768);
  assert.equal(calls.replies[0].poll.allowMultiselect, true);
});

for (const [label, values, expected] of [
  ['blank question', { soru: '  ' }, /Soruyu/u],
  ['long question', { soru: 'x'.repeat(301) }, /300/u],
  ['single option', { secenekler: 'Evet' }, /2–10/u],
  ['eleven options', { secenekler: Array.from({ length: 11 }, (_, index) => `${index}`).join('|') }, /2–10/u],
  ['empty option', { secenekler: 'Evet||Hayır' }, /Boş/u],
  ['long option', { secenekler: `${'x'.repeat(56)}|Hayır` }, /55/u],
  ['duplicate case', { secenekler: 'EVET|evet' }, /farklı/u],
  ['duplicate Turkish case', { secenekler: 'YARIŞ|yarış' }, /farklı/u],
  ['duplicate normalized Unicode', { secenekler: 'café|cafe\u0301' }, /farklı/u],
  ['duplicate whitespace', { secenekler: 'Hızlı tur|Hızlı  tur' }, /farklı/u],
  ['zero duration', { sure: 0 }, /1–768/u],
  ['excess duration', { sure: 769 }, /1–768/u],
  ['fractional duration', { sure: 1.5 }, /tam sayı/u],
]) {
  test(`poll rejects ${label} privately without publishing a poll`, async () => {
    const { result, calls } = interaction({ soru: 'Devam?', secenekler: 'Evet|Hayır', ...values });
    await byName.get('anket').execute(result);
    assert.equal(calls.replies.length, 1);
    assert.equal(calls.replies[0].poll, undefined);
    assert.equal(calls.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(description(calls.replies[0]), expected);
  });
}

for (const key of ['memberPermissions', 'appPermissions']) {
  test(`poll checks ${key}`, async () => {
    const { result, calls } = interaction({ soru: 'Devam?', secenekler: 'Evet|Hayır' }, {
      [key]: new PermissionsBitField(0n),
    });
    await byName.get('anket').execute(result);
    assert.equal(calls.replies[0].poll, undefined);
    assert.match(description(calls.replies[0]), /Anket Gönder/u);
  });

  for (const remainingPermission of [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, 0n]) {
    test(`cleanup requires both permissions in ${key} (remaining ${remainingPermission})`, async () => {
      const { result, calls } = interaction({ adet: 5 }, { [key]: new PermissionsBitField(remainingPermission) });
      await byName.get('temizle').execute(result);
      assert.equal(calls.replies[0].flags, MessageFlags.Ephemeral);
      assert.equal(calls.fetches.length, 0);
      assert.equal(calls.deletes.length, 0);
    });
  }
}

test('cleanup handles unavailable permissions conservatively', async () => {
  for (const key of ['memberPermissions', 'appPermissions']) {
    const { result, calls } = interaction({ adet: 5 }, { [key]: null });
    await byName.get('temizle').execute(result);
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.deletes.length, 0);
    assert.equal(calls.replies[0].flags, MessageFlags.Ephemeral);
  }
});

test('cleanup rejects missing, voice, forum, and thread channels', async () => {
  for (const type of [null, ChannelType.GuildVoice, ChannelType.GuildForum, ChannelType.PublicThread]) {
    const { result, calls } = interaction({ adet: 5 });
    if (type === null) result.channel = null;
    else result.channel.type = type;
    await byName.get('temizle').execute(result);
    assert.equal(calls.deletes.length, 0);
    assert.equal(calls.fetches.length, 0);
    assert.match(description(calls.replies[0]), /metin veya duyuru/u);
  }
});

test('cleanup rejects invalid counts before fetching or deleting', async () => {
  for (const adet of [0, 101, -1, 1.5, null]) {
    const { result, calls } = interaction({ adet });
    await byName.get('temizle').execute(result);
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.deletes.length, 0);
    assert.match(description(calls.replies[0]), /1–100/u);
  }
});

test('cleanup selects explicit recent unpinned deletable messages, preserving protected messages', async () => {
  const { result, calls } = interaction({ adet: 7 });
  const oldTimestamp = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const messages = new Collection([
    ['valid', message('valid')],
    ['pinned', message('pinned', { pinned: true })],
    ['unknown-pin', message('unknown-pin', { pinned: undefined })],
    ['system', message('system', { system: true })],
    ['undeletable', message('undeletable', { deletable: false })],
    ['old', message('old', { createdTimestamp: oldTimestamp - 10_000 })],
    ['boundary', message('boundary', { createdTimestamp: oldTimestamp + 1_000 })],
  ]);
  result.channel.messages.fetch = async (options) => { calls.fetches.push(options); return messages; };
  await byName.get('temizle').execute(result);
  assert.deepEqual(calls.fetches, [{ limit: 7, before: result.id, cache: false }]);
  assert.equal(calls.defers[0].flags, MessageFlags.Ephemeral);
  assert.equal(calls.deletes.length, 1);
  assert.deepEqual([...calls.deletes[0].messages.keys()], ['valid']);
  assert.equal(calls.deletes[0].filterOld, true);
  assert.match(description(calls.edits[0]), /\*\*7\*\* mesaj incelendi, \*\*1\*\* mesaj silindi/u);
});

test('cleanup does not call bulkDelete when nothing qualifies', async () => {
  const { result, calls } = interaction({ adet: 1 });
  result.channel.messages.fetch = async () => new Collection([['pinned', message('pinned', { pinned: true })]]);
  await byName.get('temizle').execute(result);
  assert.equal(calls.deletes.length, 0);
  assert.match(description(calls.edits[0]), /\*\*0\*\* mesaj silindi/u);
});

test('cleanup reports the actual deletion result', async () => {
  const { result, calls } = interaction({ adet: 2 });
  result.channel.messages.fetch = async () => new Collection([
    ['a', message('a')], ['b', message('b')],
  ]);
  result.channel.bulkDelete = async () => new Collection([['a', message('a')]]);
  await byName.get('temizle').execute(result);
  assert.match(description(calls.edits[0]), /\*\*1\*\* mesaj silindi/u);
});

test('cleanup lets API failures reach the centralized error handler', async () => {
  const { result, calls } = interaction({ adet: 1 });
  const failure = new Error('Discord API unavailable');
  result.channel.messages.fetch = async () => { throw failure; };
  await assert.rejects(() => byName.get('temizle').execute(result), failure);
  assert.equal(calls.defers[0].flags, MessageFlags.Ephemeral);
  assert.equal(calls.edits.length, 0);
  assert.equal(calls.deletes.length, 0);
});
