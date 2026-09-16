import { MessageFlags } from 'discord.js';
import { safeError } from './logger.js';

export function createInteractionHandler(commands, { logger = () => {}, now = Date.now, cooldownMs = 3000, store } = {}) {
  const registry = new Map(commands.map(command => [command.data.name, command]));
  const cooldowns = new Map();
  return async function handle(interaction) {
    if (interaction.isAutocomplete?.()) {
      const command = registry.get(interaction.commandName);
      try {
        if (!interaction.inGuild() || !command?.autocomplete) await interaction.respond([]);
        else await command.autocomplete(interaction);
      } catch (error) {
        logger('error', 'command_autocomplete_failed', { command: interaction.commandName, ...safeError(error) });
        if (!interaction.responded) await interaction.respond([]).catch(() => {});
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    const respond = async content => {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      }
    };
    try {
      if (!interaction.inGuild()) {
        await respond('Pit-Stop komutlarını bir sunucuda kullanın.');
        return;
      }
      const command = registry.get(interaction.commandName);
      if (!command) {
        await respond('Bu komut artık kullanılmıyor. /yardim ile mevcut komutları görebilirsiniz.');
        return;
      }
      const timestamp = now();
      for (const [key, expires] of cooldowns) {
        if (expires <= timestamp) cooldowns.delete(key);
      }
      const key = `${interaction.guildId}:${interaction.user.id}:${interaction.commandName}`;
      if (cooldowns.has(key)) {
        await respond('Biraz hızlısınız! Bu komutu birkaç saniye sonra tekrar deneyin.');
        return;
      }
      cooldowns.set(key, timestamp + cooldownMs);
      await command.execute(interaction);
      try {
        store?.addLog(interaction.guildId, { type: 'command.executed', actorId: interaction.user.id, message: `/${interaction.commandName} komutu işlendi.`, details: { ...(interaction.user.username ? { actorName: interaction.user.globalName || interaction.user.username } : {}), channelId: interaction.channelId } });
      } catch (error) { logger('error', 'command_log_failed', safeError(error)); }
    } catch (error) {
      logger('error', 'command_failed', { command: interaction.commandName, ...safeError(error) });
      try { if (interaction.guildId) store?.addLog(interaction.guildId, { type: 'command.failed', actorId: interaction.user.id, message: `/${interaction.commandName} tamamlanamadı.`, details: safeError(error) }); } catch { /* Preserve the original command error when logging fails. */ }
      try {
        await respond('İşlem tamamlanamadı. Botun kanal izinlerini kontrol edip tekrar deneyin.');
      } catch (replyError) {
        logger('error', 'error_reply_failed', safeError(replyError));
      }
    }
  };
}
