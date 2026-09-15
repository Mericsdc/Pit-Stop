import { Events, PermissionFlagsBits } from 'discord.js';
import { safeError } from './logger.js';

function label(user) {
  return user.globalName || user.global_name || user.username || user.tag || user.id;
}

function reactionKey(emoji) {
  return emoji?.id ? `custom:${emoji.id}` : `unicode:${emoji?.name || ''}`;
}

export function createReactionRoleHandler(store, { logger = () => {} } = {}) {
  return async function handleReaction(reaction, user, action) {
    if (!reaction || !user || user.bot || !['add', 'remove'].includes(action)) return false;
    try {
      if (reaction.partial) reaction = await reaction.fetch();
      if (user.partial) user = await user.fetch();
      if (reaction.message?.partial) await reaction.message.fetch();
      const guild = reaction.message?.guild;
      if (!guild) return false;
      const record = store.getRecord(guild.id, 'reaction_role', reaction.message.id);
      if (!record) return false;
      const mapping = record.mappings?.find(item => item.key === reactionKey(reaction.emoji));
      if (!mapping) return false;

      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(mapping.roleId) || await guild.roles.fetch(mapping.roleId);
      if (!role || role.managed || !role.editable || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('Rol bot tarafından yönetilemiyor.');
      }

      const hasRole = member.roles.cache.has(role.id);
      if (action === 'add' && !hasRole) await member.roles.add(role, 'Pit-Stop emoji ile rol verme');
      if (action === 'remove' && hasRole) await member.roles.remove(role, 'Pit-Stop emoji rolü kaldırıldı');
      if ((action === 'add' && hasRole) || (action === 'remove' && !hasRole)) return true;

      store.addLog(guild.id, {
        type: action === 'add' ? 'reaction_role.assigned' : 'reaction_role.removed',
        actorId: user.id,
        message: `${label(user)} ${action === 'add' ? `${role.name} rolünü aldı` : `${role.name} rolünü kaldırdı`}.`,
        details: { actorName: label(user), channelId: reaction.message.channelId, messageId: reaction.message.id, roleId: role.id, roleName: role.name, emoji: mapping.label, action },
      });
      return true;
    } catch (error) {
      const guildId = reaction?.message?.guildId || reaction?.message?.guild?.id;
      if (guildId) store.addLog(guildId, {
        type: 'reaction_role.error',
        actorId: user?.id || null,
        message: 'Emoji rolü uygulanamadı.',
        details: { actorName: user ? label(user) : null, messageId: reaction?.message?.id || null, reason: 'Bot rolü, kanal izni veya Discord bağlantısı uygun değil.' },
      });
      logger('warn', 'reaction_role_failed', { ...safeError(error), guildId, userId: user?.id });
      return false;
    }
  };
}

export function installReactionRoles(client, store, options = {}) {
  const handle = createReactionRoleHandler(store, options);
  const onAdd = (reaction, user) => { void handle(reaction, user, 'add'); };
  const onRemove = (reaction, user) => { void handle(reaction, user, 'remove'); };
  client.on(Events.MessageReactionAdd, onAdd);
  client.on(Events.MessageReactionRemove, onRemove);
  return () => {
    client.off(Events.MessageReactionAdd, onAdd);
    client.off(Events.MessageReactionRemove, onRemove);
  };
}
