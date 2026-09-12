import {
  ApplicationIntegrationType,
  ChannelType,
  EmbedBuilder,
  escapeMarkdown,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { rememberCommandDeletion } from './deletion-audit.js';

const BRAND_COLOR = 0xf45132;
const DELETE_PERMISSIONS = PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ReadMessageHistory;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const DELETE_AGE_MARGIN_MS = 5_000;

function embed(title, description) {
  const result = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Pit-Stop • ${title}`)
    .setFooter({ text: 'Pit-Stop | Sunucunun mola noktası' });
  if (description) result.setDescription(description);
  return result;
}

function privateReply(interaction, title, description) {
  return interaction.reply({
    embeds: [embed(title, description)],
    flags: MessageFlags.Ephemeral,
  });
}

function command(name, description, execute, configure = (data) => data) {
  const data = configure(new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall));

  return {
    data,
    async execute(interaction) {
      if (!interaction.inGuild()) {
        return privateReply(interaction, 'Sunucu gerekli', 'Bu komutu bir Discord sunucusunda kullanabilirsin.');
      }
      return execute(interaction);
    },
  };
}

function parsePoll(questionInput, answersInput, duration, allowMultiselect) {
  const question = questionInput?.trim();
  const answers = answersInput?.split('|').map((answer) => answer.trim()) ?? [];

  if (!question || question.length > 300) {
    return { error: 'Soruyu 1–300 karakter arasında yaz.' };
  }
  if (answers.length < 2 || answers.length > 10) {
    return { error: '2–10 seçenek yaz ve seçenekleri | işaretiyle ayır. Örnek: Evet | Hayır' };
  }
  if (answers.some((answer) => !answer || answer.length > 55)) {
    return { error: 'Her seçenek 1–55 karakter olmalı. Boş seçenek bırakamazsın.' };
  }
  const normalizedAnswers = answers.map((answer) => answer
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('tr-TR'));
  if (new Set(normalizedAnswers).size !== answers.length) {
    return { error: 'Her seçenek farklı olmalı; aynı seçeneği birden fazla kez yazma.' };
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 768) {
    return { error: 'Anket süresi 1–768 saat arasında bir tam sayı olmalı.' };
  }

  return {
    poll: {
      question: { text: question },
      answers: answers.map((text) => ({ text })),
      duration,
      allowMultiselect: Boolean(allowMultiselect),
    },
  };
}

export const commands = [
  command('yardim', 'Pit-Stop komutlarını ve kullanım örneklerini gösterir.', async (interaction) => {
    return privateReply(interaction, 'Garaja hoş geldin', [
      '**/ping** — Botun bağlantı ve komut gecikmesini ölçer.',
      '**/sunucu** — Sunucunun temel bilgilerini gösterir.',
      '**/avatar [kullanici]** — Senin veya seçtiğin kişinin profil resmini gösterir.',
      '**/anket soru secenekler [sure] [coklu]** — Discord anketi oluşturur.',
      'Örnek seçenekler: `Yarış | Sohbet | Film` · Varsayılan süre: 24 saat.',
      '**/temizle adet** veya **/clear adet** — Son 1–100 mesajı inceler; uygun mesajları siler.',
      'Temizleme için **Mesajları Yönet** ve **Mesaj Geçmişini Oku**, anket için **Anket Gönder** izni gerekir.',
      'Sabitlenmiş mesajlar, sistem mesajları ve 14 günden eski mesajlar korunur.',
      '**/play sarki** — Şarkı adı, YouTube / YouTube Music veya Spotify bağlantısıyla müzik başlatır.',
      '**/pause**, **/resume**, **/skip**, **/stop**, **/queue**, **/volume seviye** — Müzik kontrolleri. Önce botla aynı ses kanalına katıl.',
      '**!özelkomut** — Panelde tanımlanan otomatik cevapları çağırır. Ayrılma mesajları, otomatik rol, cevaplar ve müzik ayarları yönetim panelinden düzenlenir.',
      '**/hatırlat not:2 saat sonra NFS turnuvası var** — DM veya kanal hatırlatması. **/hatırlatıcılar** ile listele/iptal et.',
      '**/sağlık-asistanı durum:aç** — Kişisel mola hatırlatmaları.',
      '**/uyar**, **/bilet-kapat**, **/savunma-yanıt** — Yetkili destek ve savunma işlemleri.',
    ].join('\n\n'));
  }),

  command('ping', 'Pit-Stop bağlantı durumunu ve gecikmesini gösterir.', async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const gatewayPing = interaction.client.ws.ping;
    return interaction.editReply({
      embeds: [embed('Motor çalışıyor').addFields(
        { name: 'Discord bağlantısı', value: gatewayPing >= 0 ? `${Math.round(gatewayPing)} ms` : 'Ölçüm bekleniyor', inline: true },
        { name: 'Komut gecikmesi', value: `${Math.max(0, Date.now() - interaction.createdTimestamp)} ms`, inline: true },
      )],
    });
  }),

  command('sunucu', 'Sunucunun üye sayısını ve temel bilgilerini gösterir.', async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId);
    const result = embed('Sunucu bilgileri', escapeMarkdown(guild.name)).addFields(
      { name: 'Üye sayısı', value: guild.memberCount.toLocaleString('tr-TR'), inline: true },
      { name: 'Kanal sayısı', value: guild.channels.cache.size.toLocaleString('tr-TR'), inline: true },
      { name: 'Takviye sayısı', value: (guild.premiumSubscriptionCount ?? 0).toLocaleString('tr-TR'), inline: true },
      { name: 'Kuruluş tarihi', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'Sunucu kimliği', value: guild.id, inline: true },
    );
    const icon = guild.iconURL({ size: 256 });
    if (icon) result.setThumbnail(icon);
    return interaction.editReply({ embeds: [result] });
  }),

  command('avatar', 'Senin veya seçtiğin kişinin profil resmini gösterir.', async (interaction) => {
    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    const avatarURL = user.displayAvatarURL({ size: 1024 });
    return interaction.reply({
      embeds: [embed('Profil resmi', `${escapeMarkdown(user.displayName)}\n[Resmi aç](${avatarURL})`).setImage(avatarURL)],
      flags: MessageFlags.Ephemeral,
    });
  }, (data) => data.addUserOption((option) => option
    .setName('kullanici').setDescription('Profil resmi gösterilecek kişi.'))),

  command('anket', 'Kanala 2–10 seçenekli bir Discord anketi gönderir.', async (interaction) => {
    if (interaction.channel?.type !== ChannelType.GuildText) {
      return privateReply(interaction, 'Uygun kanal gerekli', 'Anketi normal bir sunucu metin kanalında oluştur.');
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.SendPolls)) {
      return privateReply(interaction, 'Anket iznin yok', 'Bu kanalda **Anket Gönder** iznine ihtiyacın var.');
    }
    if (!interaction.appPermissions?.has(PermissionFlagsBits.SendPolls)) {
      return privateReply(interaction, 'Anket izni gerekli', 'Pit-Stop için bu kanalda **Anket Gönder** iznini aç.');
    }

    const { poll, error } = parsePoll(
      interaction.options.getString('soru', true),
      interaction.options.getString('secenekler', true),
      interaction.options.getInteger('sure') ?? 24,
      interaction.options.getBoolean('coklu') ?? false,
    );
    if (error) return privateReply(interaction, 'Anketi düzenle', error);

    return interaction.reply({
      embeds: [embed('Söz sende', `Süre: **${poll.duration} saat** · ${poll.allowMultiselect ? 'Birden fazla seçenek işaretleyebilirsin.' : 'Tek seçenek işaretleyebilirsin.'}`)],
      poll,
    });
  }, (data) => data
    .setDefaultMemberPermissions(PermissionFlagsBits.SendPolls)
    .addStringOption((option) => option
      .setName('soru').setDescription('Anket sorusu (en fazla 300 karakter).')
      .setRequired(true).setMinLength(1).setMaxLength(300))
    .addStringOption((option) => option
      .setName('secenekler').setDescription('2–10 seçenek; | ile ayır. Örnek: Yarış | Sohbet | Film')
      .setRequired(true).setMinLength(3).setMaxLength(569))
    .addIntegerOption((option) => option
      .setName('sure').setDescription('Saat olarak süre; varsayılan 24, en fazla 768 (32 gün).')
      .setMinValue(1).setMaxValue(768))
    .addBooleanOption((option) => option
      .setName('coklu').setDescription('Birden fazla seçenek işaretlenebilsin mi? Varsayılan: hayır.'))),

  command('temizle', 'Son mesajları inceler; sabitlenmemiş uygun mesajları siler.', async (interaction) => {
    const channel = interaction.channel;
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
      || typeof channel.bulkDelete !== 'function' || typeof channel.messages?.fetch !== 'function') {
      return privateReply(interaction, 'Uygun kanal gerekli', 'Temizleme komutunu bir sunucu metin veya duyuru kanalında kullan.');
    }
    if (!interaction.memberPermissions?.has(DELETE_PERMISSIONS)) {
      return privateReply(interaction, 'Temizleme iznin yok', 'Bu kanalda **Mesajları Yönet** ve **Mesaj Geçmişini Oku** izinlerine ihtiyacın var.');
    }
    if (!interaction.appPermissions?.has(DELETE_PERMISSIONS)) {
      return privateReply(interaction, 'Temizleme izni gerekli', 'Pit-Stop için bu kanalda **Mesajları Yönet** ve **Mesaj Geçmişini Oku** izinlerini aç.');
    }
    const count = interaction.options.getInteger('adet', true);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return privateReply(interaction, 'Geçersiz adet', 'İncelenecek mesaj sayısını 1–100 arasında bir tam sayı olarak yaz.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Fetch current pin state. Bound the scan to messages sent before the command.
    const recent = await channel.messages.fetch({ limit: count, before: interaction.id, cache: false });
    const cutoff = Date.now() - TWO_WEEKS_MS + DELETE_AGE_MARGIN_MS;
    const eligible = recent.filter((message) => message.pinned === false
      && message.system === false && message.deletable === true
      && Number.isFinite(message.createdTimestamp) && message.createdTimestamp > cutoff);
    // Pass explicit messages, never a count, so protected messages cannot be selected again.
    const forgetDeletion = rememberCommandDeletion(interaction.client, [...eligible.keys()], interaction.user);
    let deleted;
    try { deleted = eligible.size > 0 ? await channel.bulkDelete(eligible, true) : null; }
    catch (error) { forgetDeletion(); throw error; }
    const deletedCount = deleted?.size ?? deleted?.length ?? 0;

    return interaction.editReply({
      embeds: [embed('Pist temizliği', [
        `**${recent.size}** mesaj incelendi, **${deletedCount}** mesaj silindi.`,
        'Sabitlenmiş, sistem, silinemeyen ve 14 gün sınırındaki eski mesajlar atlanır.',
      ].join('\n\n'))],
    });
  }, (data) => data
    .setDefaultMemberPermissions(DELETE_PERMISSIONS)
    .addIntegerOption((option) => option
      .setName('adet').setDescription('İncelenecek son mesaj sayısı (1–100); uygun olmayanlar atlanır.')
      .setRequired(true).setMinValue(1).setMaxValue(100))),
];

const cleanupCommand = commands.find(({ data }) => data.name === 'temizle');
commands.push(command('clear', 'Son mesajları güvenle temizler; /temizle ile aynı çalışır.', cleanupCommand.execute, (data) => data
  .setDefaultMemberPermissions(DELETE_PERMISSIONS)
  .addIntegerOption((option) => option
    .setName('adet').setDescription('İncelenecek son mesaj sayısı (1–100); uygun olmayanlar atlanır.')
    .setRequired(true).setMinValue(1).setMaxValue(100))));
