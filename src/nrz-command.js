import { ApplicationIntegrationType, EmbedBuilder, escapeMarkdown, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { formatRaceTime, leaderboardUrl, setupUrl } from './nrz-leaderboards.js';

const COLOR = 0xf45132;
const safe = (value, length = 100) => escapeMarkdown(String(value || '').replace(/\s+/gu, ' ').slice(0, length));

function leaderboardEmbed(label, id, entries) {
  const lines = entries.map((entry, index) => {
    const rating = entry.rating ? ` · ${entry.rating} puan` : '';
    const parts = entry.tuning?.performance || [];
    const tuning = parts.length
      ? `\n⚙ ${safe(parts.slice(0, 2).join(' · '), 70)}${parts.length > 2 ? ` (+${parts.length - 2})` : ''}${entry.setupHash ? ` · [Tüm ayarlar](${setupUrl(entry.setupHash)})` : ''}`
      : entry.setupHash ? `\n⚙ [Araç ayarları](${setupUrl(entry.setupHash)})` : '';
    return `**${index + 1}. ${formatRaceTime(entry.milliseconds)}** · ${safe(entry.driver, 30)} · ${safe(entry.car, 50)}${rating}${tuning}`;
  });
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(label)
    .setDescription(lines.length ? lines.join('\n') : 'Henüz geçerli derece bulunamadı.')
    .setFooter({ text: 'NRZ Leaderboards · Süreler yaklaşık 5 dakika önbelleğe alınır' });
  if (id) embed.setURL(leaderboardUrl(id));
  return embed;
}

export function mapResponse(result) {
  if (!result.map) {
    const suggestions = result.suggestions?.map(map => `• ${safe(map.name)}`).join('\n');
    return { content: suggestions ? `Birden fazla harita bulundu. Tam adını yaz:\n${suggestions}` : 'Bu isimde yarış bulunamadı. Harita adını NRZ Leaderboards bölümündeki gibi yaz.', allowedMentions: { parse: [] } };
  }
  return {
    content: `🏁 **${safe(result.map.name)}** · ${result.map.active ? 'Aktif yarış' : 'Tüm yarışlar'}`,
    embeds: [
      leaderboardEmbed('Normal yarış · ilk 10', result.map.id, result.normal),
      leaderboardEmbed('Time Attack · ilk 10', result.map.timeAttackId, result.timeAttack),
    ],
    allowedMentions: { parse: [] },
  };
}

export function createNrzMapCommand(nrz, { logger = () => {} } = {}) {
  const cooldowns = new Map();
  const data = new SlashCommandBuilder().setName('map').setDescription('NRZ haritasının normal ve Time Attack ilk 10 süresini gösterir.')
    .setContexts(InteractionContextType.Guild).setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption(option => option.setName('harita').setDescription('NRZ yarış haritasının adı').setRequired(true).setAutocomplete(true));
  return {
    data,
    async autocomplete(interaction) {
      const query = String(interaction.options.getFocused() || '').trim().toLocaleLowerCase('tr-TR');
      const maps = await nrz.catalog();
      const choices = maps.filter(map => map.name.toLocaleLowerCase('tr-TR').includes(query))
        .slice(0, 25).map(map => ({ name: map.name.slice(0, 100), value: map.name.slice(0, 100) }));
      await interaction.respond(choices);
    },
    async execute(interaction) {
      await interaction.deferReply();
      const query = interaction.options.getString('harita');
      await interaction.editReply(mapResponse(await nrz.getMap(query)));
    },
    async handleMessage(message) {
      if (!message.guildId || message.author?.bot || message.webhookId) return false;
      const match = /^!map(?:\s+(.+))?\s*$/iu.exec(String(message.content || ''));
      if (!match) return false;
      const query = match[1]?.trim();
      if (!query || query.length > 100) {
        await message.reply({ content: 'Kullanım: `!map Harita Adı` — örnek: `!map Agathe Street`', allowedMentions: { parse: [] } });
        return true;
      }
      const key = `${message.guildId}:${message.author.id}`;
      const now = Date.now();
      if ((cooldowns.get(key) || 0) > now) return true;
      cooldowns.set(key, now + 5000);
      if (cooldowns.size > 5000) for (const [id, until] of cooldowns) if (until <= now) cooldowns.delete(id);
      try {
        await message.channel?.sendTyping?.();
        await message.reply(mapResponse(await nrz.getMap(query)));
      } catch (error) {
        logger('error', 'nrz_map_failed', { message: error.message });
        await message.reply({ content: 'NRZ sıralaması şu anda alınamadı. Biraz sonra tekrar dene.', allowedMentions: { parse: [] } });
      }
      return true;
    },
  };
}
