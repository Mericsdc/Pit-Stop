import { ChannelType, EmbedBuilder, Events, PermissionFlagsBits } from 'discord.js';
import { userLabel } from './audit.js';
import { createDeletionAudit, commandDeletionActor } from './deletion-audit.js';

const NO_MENTIONS = Object.freeze({ parse: [], repliedUser: false });
const RESPONDER_USER_COOLDOWN_MS = 5_000;
const RESPONDER_GUILD_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_ENTRIES = 10_000;

function branded(title, description) {
  return new EmbedBuilder()
    .setColor(0xf45132)
    .setTitle(`Pit-Stop • ${title}`)
    .setDescription(description.slice(0, 3900))
    .setFooter({ text: 'Pit-Stop | Sunucunun mola noktası' }).setTimestamp();
}

function safeCode(error) {
  return typeof error?.code === 'number' || /^[A-Z_\d]{1,50}$/u.test(error?.code)
    ? error.code : 'UNKNOWN';
}

function normalized(value) {
  return value.normalize('NFKC').toLocaleLowerCase('tr-TR');
}

function remember(map, key, deadline) {
  if (map.size >= MAX_COOLDOWN_ENTRIES && !map.has(key)) map.delete(map.keys().next().value);
  map.set(key, deadline);
}

export function installCommunityHandlers(client, store, { logger = () => {}, deletionAudit = createDeletionAudit() } = {}) {
  const listeners = [];
  const userCooldowns = new Map();
  const guildCooldowns = new Map();
  const logCooldowns = new Map();

  function diagnostic(level, event, details) {
    // The logger receives metadata only, never Discord request objects or raw errors.
    if (typeof logger === 'function') logger(level, event, details);
    else if (typeof logger?.[level] === 'function') logger[level](event, details);
  }

  async function record(guild, entry) {
    store.addLog(guild.id, entry);
    const settings = store.getSettings(guild.id);
    if (!settings.logChannelId) return;
    const now = Date.now();
    if ((logCooldowns.get(guild.id) ?? 0) > now) return;
    remember(logCooldowns, guild.id, now + 1_000);
    try {
      const channel = guild.channels.cache.get(settings.logChannelId)
        ?? await guild.channels.fetch(settings.logChannelId);
      if (!channel || channel.guildId !== guild.id
        || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return;
      await channel.send({
        embeds: [branded('Sunucu günlüğü', `${entry.message}\n\n**Olay:** ${entry.type}`)],
        allowedMentions: NO_MENTIONS,
      });
    } catch (error) {
      diagnostic('warn', 'community.log_channel_failed', { guildId: guild.id, code: safeCode(error) });
    }
  }

  function on(event, handler) {
    const guarded = async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        const guild = args.find((arg) => arg?.guild)?.guild;
        diagnostic('error', 'community.event_failed', { event, guildId: guild?.id, code: safeCode(error) });
        if (guild) {
          try {
            store.addLog(guild.id, {
              type: 'community.error',
              actorId: null,
              message: 'Bir topluluk işlemi tamamlanamadı. Bot izinlerini ve ayarları kontrol et.',
              details: { event, code: safeCode(error) },
            });
          } catch (storeError) {
            diagnostic('error', 'community.log_failed', { guildId: guild.id, code: safeCode(storeError) });
          }
        }
      }
    };
    client.on(event, guarded);
    listeners.push([event, guarded]);
  }

  on(Events.GuildMemberAdd, async (member) => {
    await record(member.guild, {
      type: 'member.join', actorId: member.id,
      message: `${userLabel(member)} sunucuya katıldı.`, details: { memberId: member.id, memberName: userLabel(member), actorName: userLabel(member) },
    });
    const settings = store.getSettings(member.guild.id);
    const roleIds = settings.autoRoleIds?.length ? settings.autoRoleIds : settings.autoRoleId ? [settings.autoRoleId] : [];
    if (!settings.autoRoleEnabled || !roleIds.length || member.user.bot) return;
    for (const roleId of roleIds) {
    const role = await member.guild.roles.fetch(roleId);
    const botMember = member.guild.members.me ?? await member.guild.members.fetchMe();
    if (!role || role.id === member.guild.id || role.managed || !role.editable
      || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await record(member.guild, {
        type: 'autorole.error', actorId: member.id,
        message: 'Otomatik rol verilemedi: rol ve bot hiyerarşisini, Rol Yönet iznini kontrol et.',
        details: { memberId: member.id, memberName: userLabel(member), roleId },
      });
      continue;
    }
    await member.roles.add(role, 'Pit-Stop otomatik katılım rolü');
    await record(member.guild, {
      type: 'autorole.assigned', actorId: member.id,
      message: `${userLabel(member)} üyesine ${role.name || role.id} rolü verildi.`, details: { memberId: member.id, memberName: userLabel(member), roleId: role.id, roleName: role.name },
    });
    }
  });

  on(Events.GuildMemberRemove, async (member) => {
    await record(member.guild, {
      type: 'member.leave', actorId: member.id,
      message: `${userLabel(member)} sunucudan ayrıldı.`, details: { memberId: member.id, memberName: userLabel(member), actorName: userLabel(member) },
    });
    const settings = store.getSettings(member.guild.id);
    if (settings.blacklistOnLeave && !member.user?.bot && store.putRecord) {
      store.putRecord(member.guild.id, 'blacklist', member.id, { name: userLabel(member), reason: 'Sunucudan ayrıldı', source: 'leave', createdAt: Date.now(), addedBy: client.user?.id });
    }
    if (!settings.leaveEnabled || !settings.leaveChannelId) return;
    const channel = await member.guild.channels.fetch(settings.leaveChannelId);
    if (!channel || channel.guildId !== member.guild.id
      || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      await record(member.guild, {
        type: 'leave.error', actorId: member.id,
        message: 'Ayrılma mesajı gönderilemedi: seçilen metin kanalı bulunamadı.',
        details: { channelId: settings.leaveChannelId },
      });
      return;
    }
    const replacements = {
      user: `<@${member.id}>`,
      username: member.user?.username ?? member.id,
      server: member.guild.name,
      memberCount: String(member.guild.memberCount),
    };
    const message = settings.leaveMessage.replace(/\{(user|username|server|memberCount)\}/gu,
      (_, token) => replacements[token]);
    await channel.send({ embeds: [branded('Görüşmek üzere', message)], allowedMentions: NO_MENTIONS });
  });

  on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author?.bot || !message.author?.id || message.webhookId
      || typeof message.content !== 'string' || !message.content.startsWith('!')) return;
    const settings = store.getSettings(message.guild.id);
    if (!settings.responderEnabled) return;
    const response = settings.responses.find(({ trigger }) => normalized(message.content) === `!${normalized(trigger)}`);
    if (!response) return;

    const now = Date.now();
    const userKey = `${message.guild.id}:${message.author.id}`;
    if ((userCooldowns.get(userKey) ?? 0) > now || (guildCooldowns.get(message.guild.id) ?? 0) > now) return;
    remember(userCooldowns, userKey, now + RESPONDER_USER_COOLDOWN_MS);
    remember(guildCooldowns, message.guild.id, now + RESPONDER_GUILD_COOLDOWN_MS);
    await message.reply({
      embeds: [branded('Otomatik yanıt', response.reply)],
      allowedMentions: NO_MENTIONS,
    });
    await record(message.guild, {
      type: 'responder.sent', actorId: message.author.id,
      message: `${userLabel(message.author)} için !${response.trigger} yanıtı gönderildi.`, details: { actorName: userLabel(message.author), channelId: message.channelId, trigger: response.trigger, input: message.content.slice(0, 100), reply: response.reply },
    });
  });

  on(Events.ClientReady, async () => {
    for (const guild of client.guilds?.cache.values() || []) await deletionAudit.prime(guild);
  });

  on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;
    const actor = commandDeletionActor(client, [message.id]) || await deletionAudit.resolve(message.guild, { channelId: message.channelId, authorId: message.author?.id });
    await record(message.guild, {
      type: 'message.delete', actorId: actor.actorId,
      message: actor.actorId ? `${actor.actorName}, ${userLabel(message.author)} kullanıcısının mesajını sildi.` : 'Bir mesaj silindi; silen kişi Discord tarafından bildirilmedi.',
      details: { ...actor, messageId: message.id, channelId: message.channelId, authorId: message.author?.id ?? null, authorName: userLabel(message.author) },
    });
  });

  on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!channel.guild) return;
    const actor = commandDeletionActor(client, [...messages.keys()]) || await deletionAudit.resolve(channel.guild, { channelId: channel.id, count: messages.size, bulk: true });
    await record(channel.guild, {
      type: 'message.bulk_delete', actorId: actor.actorId,
      message: actor.actorId ? `${actor.actorName}, ${messages.size} mesajı toplu olarak sildi.` : `${messages.size} mesaj toplu olarak silindi; silen kişi Discord tarafından bildirilmedi.`,
      details: { ...actor, channelId: channel.id, count: messages.size },
    });
  });

  on(Events.GuildMemberUpdate, async (previous, current) => {
    if (previous.partial || current.partial) return;
    const addedRoles = current.roles.cache.filter((role) => !previous.roles.cache.has(role.id)).map((role) => role.id);
    const removedRoles = previous.roles.cache.filter((role) => !current.roles.cache.has(role.id)).map((role) => role.id);
    if (addedRoles.length || removedRoles.length) {
      await record(current.guild, {
        type: 'member.roles_update', actorId: null,
        message: 'Bir üyenin rolleri değiştirildi.',
        details: { memberId: current.id, addedRoles: addedRoles.slice(0, 50), removedRoles: removedRoles.slice(0, 50) },
      });
    }
    if (previous.communicationDisabledUntilTimestamp !== current.communicationDisabledUntilTimestamp) {
      await record(current.guild, {
        type: 'member.timeout_update', actorId: null,
        message: 'Bir üyenin zaman aşımı değiştirildi.',
        details: { memberId: current.id, until: current.communicationDisabledUntilTimestamp ?? null },
      });
    }
  });

  return function uninstall() {
    for (const [event, listener] of listeners) client.off(event, listener);
    userCooldowns.clear();
    guildCooldowns.clear();
    logCooldowns.clear();
  };
}
