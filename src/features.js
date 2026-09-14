import { ActionRowBuilder, ActivityType, AuditLogEvent, ButtonBuilder, ButtonStyle, ChannelType, Events, MessageFlags, ModalBuilder, PermissionFlagsBits as P, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userLabel } from './audit.js';
import { blockedHost, createSpamDetector, extractHosts, parseReminder, PHISHING_FEED } from './protection.js';

const noMentions = { parse: [], repliedUser: false };
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: noMentions };
const command = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0);
const short = (value, max = 1000) => String(value || '').slice(0, max);
export function createFeatures(client, store, config = {}, { logger = () => {}, fetcher = fetch, now = Date.now } = {}) {
  const listeners = [], locks = new Set(), sessions = new Map(), spam = createSpamDetector({ now });
  let feed = new Set(), feedUpdatedAt = null, feedError = null, timer, refreshTimer, ticking = false;
  const record = (guildId, type, message, actorId = null, details = {}) => store.addLog(guildId, { type, message: short(message, 500), actorId, details });
  const on = (event, fn) => { const wrapped = (...args) => Promise.resolve(fn(...args)).catch(error => logger('error', 'feature_failed', { event, code: typeof error.code === 'number' ? error.code : 'UNKNOWN' })); client.on(event, wrapped); listeners.push([event, wrapped]); };
  const settings = guildId => store.getSettings(guildId);
  const hasStaff = (member, s) => member.permissions.has(P.ManageGuild) || Boolean(s.supportRoleId && member.roles.cache.has(s.supportRoleId));
  const ticketOverwrites = (guildId, userId, supportRoleId) => [{ id: guildId, deny: [P.ViewChannel] }, { id: userId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] }, { id: supportRoleId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }, { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels] }];
  const ticketControls = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Bileti Kapat').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:delete').setLabel('Kanalı Sil').setStyle(ButtonStyle.Danger),
  );
  const guildAllowed = id => {
    const home = config.allowedGuildIds?.[0];
    const allowed = home ? store.getRecord(home, 'install_policy', 'current')?.guildIds || config.allowedGuildIds : [];
    return !allowed.length || allowed.includes(id);
  };
  async function refreshFeed() {
    try {
      const response = await fetcher(PHISHING_FEED, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Feed unavailable');
      let bytes = 0, chunks = [];
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 8_000_000) throw new Error('Feed too large'); chunks.push(chunk); }
      const domains = JSON.parse(Buffer.concat(chunks).toString());
      if (!Array.isArray(domains) || domains.length < 100 || domains.length > 200000 || domains.some(d => typeof d !== 'string' || d.length > 253)) throw new Error('Invalid feed');
      feed = new Set(domains.map(d => d.toLowerCase())); feedUpdatedAt = now(); feedError = null;
      if (config.dataDir) await writeFile(join(config.dataDir, 'phishing-cache.json'), JSON.stringify({ domains: [...feed], updatedAt: feedUpdatedAt }), { mode: 0o600 });
    } catch { feedError = 'Liste güncellenemedi; son başarılı önbellek ve özel alan adları kullanılıyor.'; }
  }
  function protectionStatus() { return { domains: feed.size, updatedAt: feedUpdatedAt, error: feedError, source: PHISHING_FEED }; }
  async function openDefense(guild, user, reason, actorId) {
    const s = settings(guild.id);
    if (!s.defenseEnabled || !s.defenseChannelId) return null;
    const key = `defense:${guild.id}:${user.id}`;
    if (locks.has(key)) return null;
    locks.add(key);
    try {
      const old = store.listRecords(guild.id, 'case').find(c => c.userId === user.id && c.status === 'open');
      if (old) { const existing = await guild.channels.fetch(old.id).catch(() => null); if (existing && !existing.archived) return existing; }
      const parent = await guild.channels.fetch(s.defenseChannelId);
      if (!parent || parent.type !== ChannelType.GuildText) throw new Error('Savunma ana kanalı bulunamadı.');
      const thread = await parent.threads.create({ name: `savunma-${user.username}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440, reason: 'Pit-Stop özel savunma kaydı' });
      await thread.members.add(user.id);
      if (s.supportRoleId) { await guild.members.fetch(); const role = guild.roles.cache.get(s.supportRoleId); for (const member of (role?.members.values() || [])) if (!member.user.bot) await thread.members.add(member.id); }
      store.putRecord(guild.id, 'case', thread.id, { userId: user.id, name: userLabel(user), reason: short(reason), actorId, createdAt: now(), status: 'open' });
      await thread.send({ content: `${userLabel(user)} • Sebep: ${short(reason)}\nHata olduğunu düşünüyorsanız buradan yetkililere yazabilirsiniz. Timeout süresince Discord burada yazmayı engeller; botun DM mesajındaki “Savunma yaz” düğmesini kullanın. Yetkililer /savunma-yanıt ile DM üzerinden yanıtlayabilir.`, allowedMentions: noMentions });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`defense:${guild.id}:${thread.id}`).setLabel('Savunma yaz').setStyle(ButtonStyle.Primary));
      await user.send({ content: `${guild.name}: ${short(reason)}\nÖzel savunma odanız: https://discord.com/channels/${guild.id}/${thread.id}\nTimeout sırasında aşağıdaki düğmeden mesajınızı iletebilirsiniz.`, components: [row], allowedMentions: noMentions }).catch(() => record(guild.id, 'defense.dm_failed', 'Savunma bağlantısı DM ile iletilemedi; üyenin DM ayarları kapalı olabilir.', user.id));
      record(guild.id, 'defense.opened', `${userLabel(user)} için özel savunma odası açıldı.`, actorId, { userId: user.id, channelId: thread.id, reason: short(reason) });
      return thread;
    } finally { locks.delete(key); }
  }
  async function punish(message, reason, minutes, type, details) {
    const key = `punish:${message.guildId}:${message.author.id}`;
    if (locks.has(key)) return;
    locks.add(key);
    try {
      let deleted = false, timedOut = false;
      try { await message.delete(); deleted = true; } catch { /* Capture result in the audit trail. */ }
      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
      try { if (member?.moderatable) { await member.timeout(minutes * 60000, reason); timedOut = true; } } catch { /* Permissions or hierarchy can prevent a timeout. */ }
      record(message.guildId, type, `${userLabel(message.author)}: ${reason}`, message.author.id, { ...details, actorName: userLabel(message.author), channelId: message.channelId, messageId: message.id, content: short(message.content, 1500), deleted, timedOut, minutes });
      await message.author.send({ content: `${message.guild.name}: ${reason}. ${deleted ? 'Mesajınız silindi.' : ''} ${timedOut ? `${minutes} dakika timeout uygulandı.` : 'Yetkililere kayıt iletildi.'}`, allowedMentions: noMentions }).catch(() => {});
      await openDefense(message.guild, message.author, reason, client.user.id).catch(() => record(message.guildId, 'defense.failed', 'Savunma odası açılamadı; kanal ve thread izinlerini kontrol edin.', message.author.id));
    } finally { locks.delete(key); }
  }
  async function processMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const s = settings(message.guildId);
    if (s.antiPhishingEnabled) {
      const custom = new Set(s.phishingDomains);
      const match = extractHosts(message.content).find(host => blockedHost(host, feed) || blockedHost(host, custom));
      if (match) { await punish(message, 'Kara listedeki oltalama bağlantısı', 720, 'protection.phishing', { domain: match }); return; }
    }
    if (s.antiSpamEnabled && !message.member?.permissions.has(P.ManageMessages)) {
      const key = `${message.guildId}:${message.author.id}`;
      if (spam.hit(key, message.content)) { spam.clear(key); await punish(message, '3 saniyede aynı mesaj 5 kez gönderildi', s.spamTimeoutMinutes, 'protection.spam', {}); return; }
    }
    const conversation = store.getRecord(message.guildId, 'case', message.channelId) || store.getRecord(message.guildId, 'ticket', message.channelId);
    if (conversation) record(message.guildId, 'conversation.message', `${userLabel(message.author)} özel odada mesaj gönderdi.`, message.author.id, { channelId: message.channelId, content: short(message.content, 2000), attachments: [...message.attachments.values()].slice(0, 5).map(a => ({ name: short(a.name, 100), url: a.url })) });
  }
  async function publishTicket(guild, actorId) {
    const s = settings(guild.id);
    if (!s.ticketEnabled || !s.ticketChannelId || !s.supportRoleId) throw new Error('Bilet sistemini açıp kanal ve destek rolünü seçin.');
    const channel = await guild.channels.fetch(s.ticketChannelId);
    const payload = { content: 'Özel destek için aşağıdaki düğmeye basın. Açılan kanalı yalnızca siz ve yetkililer görebilir.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:create').setLabel('Destek Talebi Oluştur').setStyle(ButtonStyle.Primary))], allowedMentions: noMentions };
    const previous = store.getRecord(guild.id, 'ticket_panel', 'current');
    const existing = previous?.channelId === channel.id ? await channel.messages.fetch(previous.messageId).catch(() => null) : null;
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    store.putRecord(guild.id, 'ticket_panel', 'current', { channelId: channel.id, messageId: message.id });
    record(guild.id, 'ticket.published', 'Destek Talebi Oluştur düğmesi yayımlandı.', actorId, { channelId: channel.id });
  }
  async function publishFaq(guild, member, user, question, answer) {
    const s = settings(guild.id);
    if (!member?.permissions?.has(P.ManageGuild)) throw new Error('SSS yayımlamak için Sunucuyu Yönet yetkisi gerekir.');
    if (!s.faqEnabled) throw new Error('SSS sistemi kapalı. Bot ayarlarından etkinleştirin.');
    const channelId = s.faqChannelId || config.boostedEventChannelId;
    if (!channelId) throw new Error('SSS için bir Discord kanalı seçin.');
    const cleanQuestion = short(question, 300).trim(), cleanAnswer = short(answer, 1800).trim();
    if (!cleanQuestion || !cleanAnswer) throw new Error('Soru ve cevap boş bırakılamaz.');
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error('SSS kanalı bulunamadı veya mesaj gönderilemiyor.');
    const id = randomUUID();
    const message = await channel.send({ content: `❓ **${cleanQuestion}**\n${cleanAnswer}`, allowedMentions: noMentions });
    store.putRecord(guild.id, 'faq', id, { question: cleanQuestion, answer: cleanAnswer, status: 'published', channelId, messageId: message.id, createdAt: now(), createdBy: user.id, createdByName: userLabel(user) });
    record(guild.id, 'faq.published', `${userLabel(user)} bir SSS cevabı yayımladı.`, user.id, { actorName: userLabel(user), faqId: id, channelId, messageId: message.id, question: cleanQuestion, answer: cleanAnswer });
    return store.getRecord(guild.id, 'faq', id);
  }
  async function closeTicket(guildId, channel, actor, { allowOwner = false } = {}) {
    const item = store.getRecord(guildId, 'ticket', channel.id);
    if (!item) throw new Error('Bu kanal bir destek talebi değil.');
    if (item.status !== 'open') throw new Error('Bu destek talebi zaten kapalı.');
    if (allowOwner && actor.id !== item.userId && !hasStaff(actor.member, settings(guildId))) throw new Error('Bu destek talebini kapatma yetkiniz yok.');
    await channel.permissionOverwrites.edit(item.userId, { SendMessages: false });
    store.putRecord(guildId, 'ticket', channel.id, { ...item, status: 'closed', closedAt: now(), closedBy: actor.id, closedByName: userLabel(actor.user || actor) });
    record(guildId, 'ticket.closed', `${userLabel(actor.user || actor)} destek talebini kapattı.`, actor.id, { actorName: userLabel(actor.user || actor), channelId: channel.id, userId: item.userId });
    return store.getRecord(guildId, 'ticket', channel.id);
  }
  async function deleteTicket(guildId, channel, actor) {
    const item = store.getRecord(guildId, 'ticket', channel.id);
    if (!item) throw new Error('Bu kanal bir destek bileti değil.');
    if (!hasStaff(actor.member, settings(guildId)) || !actor.member?.permissions?.has(P.ManageChannels)) throw new Error('Kanalı yalnızca Kanalları Yönet iznine sahip destek yetkilileri silebilir.');
    const channelId = channel.id;
    await channel.delete(`Pit-Stop: ${userLabel(actor.user || actor)} destek kanalını sildi`);
    store.putRecord(guildId, 'ticket', channelId, { ...item, status: 'deleted', deletedAt: now(), deletedBy: actor.id, deletedByName: userLabel(actor.user || actor) });
    record(guildId, 'ticket.deleted', `${userLabel(actor.user || actor)} destek kanalını sildi.`, actor.id, { actorName: userLabel(actor.user || actor), channelId, userId: item.userId });
    return store.getRecord(guildId, 'ticket', channelId);
  }
  async function interactionHandler(i) {
    if (i.isButton?.() && i.customId === 'ticket:create') {
      await i.deferReply(ephemeral);
      const s = settings(i.guildId), key = `ticket:${i.guildId}:${i.user.id}`;
      if (!s.ticketEnabled || !s.supportRoleId) return i.editReply('Bilet sistemi şu an kapalı.');
      if (locks.has(key)) return i.editReply('Talebiniz hazırlanıyor.');
      locks.add(key);
      try {
        const tickets = store.listRecords(i.guildId, 'ticket');
        const existing = tickets.find(t => t.userId === i.user.id && t.status === 'open');
        if (existing && await i.guild.channels.fetch(existing.id).catch(() => null)) return i.editReply(`Açık talebiniz: <#${existing.id}>`);
        if (tickets.filter(t => t.status === 'open').length >= 100) return i.editReply('Açık bilet kapasitesi dolu. Bir yetkiliye bildirin.');
        const permissionOverwrites = ticketOverwrites(i.guildId, i.user.id, s.supportRoleId);
        const channel = await i.guild.channels.create({ name: `destek-${i.user.username}`.slice(0, 90), type: ChannelType.GuildText, parent: s.ticketCategoryId || undefined,
          permissionOverwrites, reason: 'Pit-Stop özel destek talebi' });
        await channel.permissionOverwrites?.set?.(permissionOverwrites, 'Pit-Stop bilet gizliliğini uygula');
        store.putRecord(i.guildId, 'ticket', channel.id, { userId: i.user.id, name: userLabel(i.user), createdAt: now(), status: 'open', closeControlPublished: true, privacyVerifiedAt: now() });
        await channel.send({ content: `Hoş geldiniz ${userLabel(i.user)}. Talebinizi yazabilirsiniz. Bilet sahibi veya destek yetkilileri bileti kapatabilir; kanalı yalnızca Kanalları Yönet iznine sahip yetkililer silebilir. Bu odadaki mesajlar panel günlüğüne kaydedilir.`, components: [ticketControls()], allowedMentions: noMentions });
        record(i.guildId, 'ticket.opened', `${userLabel(i.user)} destek talebi açtı.`, i.user.id, { channelId: channel.id });
        await i.editReply(`Özel destek kanalınız: <#${channel.id}>`);
      } finally { locks.delete(key); }
    } else if (i.isButton?.() && i.customId === 'ticket:close') {
      await i.deferReply(ephemeral);
      try {
        await closeTicket(i.guildId, i.channel, { id: i.user.id, user: i.user, member: i.member }, { allowOwner: true });
        await i.editReply('Talep kapatıldı. Kanal ve konuşma kayıtları korundu.');
      } catch (error) { await i.editReply(error.message); }
    } else if (i.isButton?.() && i.customId === 'ticket:delete') {
      await i.deferReply(ephemeral);
      try { await deleteTicket(i.guildId, i.channel, { id: i.user.id, user: i.user, member: i.member }); }
      catch (error) { await i.editReply(error.message); }
    } else if (i.isButton?.() && i.customId.startsWith('defense:')) {
      const [, guildId, id] = i.customId.split(':');
      const item = store.getRecord(guildId, 'case', id);
      if (!item || item.userId !== i.user.id || item.status !== 'open') return i.reply({ ...ephemeral, content: 'Bu savunma kaydına erişiminiz yok.' });
      const modal = new ModalBuilder().setCustomId(`appeal:${guildId}:${id}`).setTitle('Yetkililere savunma gönder').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Mesajınız').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)));
      await i.showModal(modal);
    } else if (i.isModalSubmit?.() && i.customId.startsWith('appeal:')) {
      await i.deferReply(ephemeral);
      const [, guildId, id] = i.customId.split(':'), item = store.getRecord(guildId, 'case', id);
      if (!item || item.userId !== i.user.id || item.status !== 'open') return i.editReply('Savunma kaydı kullanılamıyor.');
      if (now() - (item.lastMessageAt || 0) < 10000) return i.editReply('Yeni mesaj için 10 saniye bekleyin.');
      const guild = client.guilds.cache.get(guildId), member = await guild?.members.fetch(i.user.id).catch(() => null);
      if (!member) return i.editReply('Sunucu üyeliğiniz doğrulanamadı.');
      const text = i.fields.getTextInputValue('text'), channel = await guild.channels.fetch(id);
      await channel.send({ content: `${userLabel(i.user)} (${i.user.id}) • DM savunması\n${text}`, allowedMentions: noMentions });
      store.putRecord(guildId, 'case', id, { ...item, lastMessageAt: now() });
      record(guildId, 'defense.reply', 'Üye savunma mesajı gönderdi.', i.user.id, { content: text, channelId: id });
      await i.editReply('Mesajınız özel savunma odasına iletildi.');
    }
  }
  const commands = [
    { data: command('panel-giris', 'Pit-Stop paneli için tek kullanımlık giriş kodu üretir.'), async execute(i) {
      const s = settings(i.guildId);
      const roles = i.member?.roles?.cache;
      const allowed = i.member?.permissions?.has(P.ManageGuild)
        || (s.panelAccessRoleIds || []).some(roleId => roles?.has(roleId));
      if (!allowed) {
        record(i.guildId, 'panel.login_denied', 'Yetkisiz panel giriş kodu isteği reddedildi.', i.user.id, { actorName: userLabel(i.user) });
        return i.reply({ ...ephemeral, content: 'Panel erişimi için yetkili bir role veya Sunucuyu Yönet iznine ihtiyacınız var.' });
      }
      for (const old of store.listRecords(i.guildId, 'panel_login_code', 1000)) {
        if (old.userId === i.user.id) store.deleteRecord(i.guildId, 'panel_login_code', old.id);
      }
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      const expiresAt = now() + Math.min(5, Math.max(1, Number(s.panelCodeMinutes) || 2)) * 60_000;
      store.putRecord(i.guildId, 'panel_login_code', hash, { userId: i.user.id, userName: userLabel(i.user), expiresAt, createdAt: now() });
      record(i.guildId, 'panel.code_created', 'Tek kullanımlık panel giriş kodu üretildi.', i.user.id, { actorName: userLabel(i.user), expiresAt });
      await i.reply({ ...ephemeral, content: `Pit-Stop giriş kodunuz:\n\`${token}\`\n\nKod <t:${Math.floor(expiresAt / 1000)}:R> sona erer ve yalnızca bir kez kullanılabilir. Bu kodu kimseyle paylaşmayın.` });
    } },
    { data: command('hatırlat', 'Zamanı geldiğinde notunu DM veya kanalda hatırlat.').addStringOption(o => o.setName('not').setDescription('2 saat sonra NFS turnuvası var').setRequired(true).setMaxLength(1600)).addStringOption(o => o.setName('hedef').setDescription('Bildirim yeri').addChoices({ name: 'DM', value: 'dm' }, { name: 'Bu kanal', value: 'channel' })), async execute(i) {
      if (store.listRecords(i.guildId, 'reminder').filter(r => r.userId === i.user.id && r.status === 'pending').length >= 20) return i.reply({ ...ephemeral, content: 'En fazla 20 bekleyen hatırlatıcı oluşturabilirsiniz.' });
      let parsed; try { parsed = parseReminder(i.options.getString('not', true), now()); } catch (error) { return i.reply({ ...ephemeral, content: error.message }); }
      const id = randomUUID(); store.putRecord(i.guildId, 'reminder', id, { ...parsed, userId: i.user.id, name: userLabel(i.user), channelId: i.channelId, destination: i.options.getString('hedef') || 'dm', status: 'pending', createdAt: now(), attempts: 0 });
      record(i.guildId, 'reminder.created', 'Hatırlatıcı oluşturuldu.', i.user.id, { dueAt: parsed.dueAt, id, destination: i.options.getString('hedef') || 'dm' });
      await i.reply({ ...ephemeral, content: `Hatırlatıcı kaydedildi: <t:${Math.floor(parsed.dueAt / 1000)}:F>\n${parsed.text}\nKimlik: ${id}` });
    } },
    { data: command('hatırlatıcılar', 'Bekleyen hatırlatıcılarını göster veya iptal et.').addStringOption(o => o.setName('iptal').setDescription('İptal edilecek hatırlatıcı kimliği')), async execute(i) {
      const id = i.options.getString('iptal');
      if (id) { const item = store.getRecord(i.guildId, 'reminder', id); if (!item || item.userId !== i.user.id) return i.reply({ ...ephemeral, content: 'Hatırlatıcı bulunamadı.' }); store.deleteRecord(i.guildId, 'reminder', id); return i.reply({ ...ephemeral, content: 'Hatırlatıcı iptal edildi.' }); }
      const items = store.listRecords(i.guildId, 'reminder').filter(r => r.userId === i.user.id && r.status === 'pending');
      await i.reply({ ...ephemeral, content: items.map(r => `${r.id}\n<t:${Math.floor(r.dueAt / 1000)}:R> ${short(r.text, 40)}`).join('\n').slice(0, 1900) || 'Bekleyen hatırlatıcınız yok.' });
    } },
    { data: command('healthcare', 'Uzun oturumlar için kişisel mola hatırlatmalarını aç veya kapat.').addStringOption(o => o.setName('durum').setDescription('Seçiminiz').setRequired(true).addChoices({ name: 'aç', value: 'on' }, { name: 'kapat', value: 'off' })).addStringOption(o => o.setName('hedef').setDescription('Bildirim yeri').addChoices({ name: 'DM', value: 'dm' }, { name: 'Bu kanal', value: 'channel' })), async execute(i) {
      const enabled = i.options.getString('durum') === 'on';
      store.putRecord(i.guildId, 'health', i.user.id, { enabled, name: userLabel(i.user), destination: i.options.getString('hedef') || 'dm', channelId: i.channelId }); sessions.delete(`${i.guildId}:${i.user.id}`);
      await i.reply({ ...ephemeral, content: enabled ? 'Sağlık asistanı açıldı. Kesintisiz ses kanalı oturumu veya etkin oyun süresi için mola hatırlatacağım. Oyun takibi, sunucuda Presence Intent açık olduğunda çalışır.' : 'Sağlık asistanı kapatıldı; oturum takibi durduruldu.' });
    } },
    { data: command('bilet-kapat', 'Bu destek talebini kapatır ve kaydı korur.'), async execute(i) {
      if (!hasStaff(i.member, settings(i.guildId))) return i.reply({ ...ephemeral, content: 'Destek yetkisi gerekli.' });
      const item = store.getRecord(i.guildId, 'ticket', i.channelId); if (!item) return i.reply({ ...ephemeral, content: 'Bu kanal bir destek talebi değil.' });
      await i.deferReply(ephemeral);
      try { await closeTicket(i.guildId, i.channel, { id: i.user.id, user: i.user, member: i.member }); await i.editReply('Talep kapatıldı. Kanal ve konuşma kayıtları korundu.'); }
      catch (error) { await i.editReply(error.message); }
    } },
    { data: command('uyar', 'Üyeyi uyarır ve etkinse özel savunma odası açar.').setDefaultMemberPermissions(P.ModerateMembers).addUserOption(o => o.setName('üye').setDescription('Uyarılacak üye').setRequired(true)).addStringOption(o => o.setName('sebep').setDescription('Kural ihlali').setRequired(true).setMaxLength(1000)), async execute(i) {
      if (!i.member.permissions.has(P.ModerateMembers)) return i.reply({ ...ephemeral, content: 'Üyeleri Zamanaşımına Uğrat izni gerekli.' });
      const user = i.options.getUser('üye', true), member = await i.guild.members.fetch(user.id), reason = i.options.getString('sebep', true);
      if (user.bot || user.id === i.user.id || member.id === i.guild.ownerId || (i.user.id !== i.guild.ownerId && i.member.roles.highest.comparePositionTo(member.roles.highest) <= 0)) return i.reply({ ...ephemeral, content: 'Bu üyeye işlem yapamazsınız.' });
      await i.deferReply(ephemeral); record(i.guildId, 'moderation.warning', `${userLabel(user)} uyarıldı.`, i.user.id, { userId: user.id, reason });
      await user.send({ content: `${i.guild.name} • Uyarı: ${reason}`, allowedMentions: noMentions }).catch(() => {});
      await openDefense(i.guild, user, reason, i.user.id); await i.editReply('Uyarı kaydedildi.');
    } },
    { data: command('savunma-yanıt', 'Savunma odasındaki üyeye bot DM üzerinden yanıt verir.').setDefaultMemberPermissions(P.ManageGuild).addStringOption(o => o.setName('mesaj').setDescription('Üyeye gönderilecek yanıt').setRequired(true).setMaxLength(1500)), async execute(i) {
      if (!hasStaff(i.member, settings(i.guildId))) return i.reply({ ...ephemeral, content: 'Destek yetkisi gerekli.' });
      const item = store.getRecord(i.guildId, 'case', i.channelId); if (!item || item.status !== 'open') return i.reply({ ...ephemeral, content: 'Bu kanalda açık savunma kaydı yok.' });
      await i.deferReply(ephemeral); const text = i.options.getString('mesaj', true), user = await client.users.fetch(item.userId);
      await user.send({ content: `${i.guild.name} • Yetkili ${userLabel(i.user)}\n${text}`, allowedMentions: noMentions });
      await i.channel.send({ content: `${userLabel(i.user)} • Üyeye DM yanıtı\n${text}`, allowedMentions: noMentions }); record(i.guildId, 'defense.staff_reply', 'Yetkili savunmaya yanıt verdi.', i.user.id, { userId: item.userId, channelId: i.channelId, content: text }); await i.editReply('Yanıt iletildi.');
    } },
  ];
  async function deliver(guildId, item, content) {
    const guild = client.guilds.cache.get(guildId); if (!guild) throw new Error('Guild absent');
    const member = await guild.members.fetch(item.userId || item.id);
    if (item.destination === 'channel') {
      const channel = await guild.channels.fetch(item.channelId);
      if (!channel?.isTextBased() || !channel.permissionsFor(member)?.has(P.ViewChannel)) throw new Error('Channel unavailable');
      await channel.send({ content: `<@${member.id}> ${content}`, allowedMentions: { parse: [], users: [member.id] } });
    } else await member.send({ content, allowedMentions: noMentions });
  }
  async function tick() {
    if (ticking || !client.isReady()) return; ticking = true;
    try {
      spam.prune();
      for (const item of store.listRecords(null, 'reminder', 10000)) {
        if (item.status !== 'pending' || item.dueAt > now() || (item.retryAt || 0) > now()) continue;
        try { await deliver(item.guildId, item, `⏰ Hatırlatma: ${item.text}`); store.putRecord(item.guildId, 'reminder', item.id, { ...item, status: 'sent', sentAt: now() }); record(item.guildId, 'reminder.sent', 'Hatırlatıcı gönderildi.', item.userId, { id: item.id, channelId: item.destination === 'channel' ? item.channelId : null }); }
        catch { const attempts = item.attempts + 1; store.putRecord(item.guildId, 'reminder', item.id, { ...item, attempts, status: attempts >= 3 ? 'failed' : 'pending', retryAt: now() + 60000 }); if (attempts >= 3) record(item.guildId, 'reminder.failed', 'Hatırlatıcı iletilemedi; DM, kanal izinleri veya üyelik kontrol edilmeli.', item.userId, { id: item.id }); }
      }
      for (const item of store.listRecords(null, 'health', 10000)) {
        const key = `${item.guildId}:${item.id}`, s = settings(item.guildId), guild = client.guilds.cache.get(item.guildId), member = guild?.members.cache.get(item.id);
        const active = item.enabled && s.healthEnabled && member && (member.voice?.channelId || (config.presenceEnabled && member.presence?.activities.some(a => a.type === ActivityType.Playing)));
        if (!active) { sessions.delete(key); continue; }
        const since = sessions.get(key) || now(); sessions.set(key, since);
        if (now() - since >= s.healthHours * 3600000) {
          sessions.set(key, now());
          try { await deliver(item.guildId, item, '🌿 Mola vakti! Gözlerini dinlendir, bir bardak su iç ve duruşunu değiştir. Küçük bir yürüyüş iyi gelebilir.'); record(item.guildId, 'health.sent', 'Kişisel mola hatırlatması gönderildi.', item.id); }
          catch { record(item.guildId, 'health.failed', 'Mola hatırlatması iletilemedi.', item.id); }
        }
      }
      for (const kind of ['reminder', 'ticket', 'case']) for (const item of store.listRecords(null, kind, 10000)) if (['sent', 'failed', 'closed'].includes(item.status) && now() - (item.sentAt || item.closedAt || item.createdAt) > 30 * 86400000) store.deleteRecord(item.guildId, kind, item.id);
    } finally { ticking = false; }
  }
  function install() {
    on(Events.MessageCreate, processMessage);
    on(Events.MessageUpdate, (_old, current) => { if (current.guild && current.content && settings(current.guildId).antiPhishingEnabled) { const s = settings(current.guildId); if (extractHosts(current.content).some(h => blockedHost(h, feed) || blockedHost(h, new Set(s.phishingDomains)))) return punish(current, 'Düzenlenmiş mesajda oltalama bağlantısı', 720, 'protection.phishing', {}); } });
    on(Events.InteractionCreate, async i => {
      try { await interactionHandler(i); }
      catch { if (i.deferred || i.replied) await i.editReply({ content: 'İşlem tamamlanamadı. Kanal, rol hiyerarşisi ve bot izinlerini kontrol edin.', allowedMentions: noMentions }).catch(() => {}); else if (i.isButton?.() || i.isModalSubmit?.()) await i.reply({ ...ephemeral, content: 'İşlem tamamlanamadı. Yetkililer bot izinlerini kontrol etmelidir.' }).catch(() => {}); }
    });
    on(Events.VoiceStateUpdate, (_old, current) => { if (!current.channelId && !(config.presenceEnabled && current.member?.presence?.activities.some(a => a.type === ActivityType.Playing))) sessions.delete(`${current.guild.id}:${current.id}`); });
    on(Events.PresenceUpdate, (_old, current) => { if (!current.member?.voice?.channelId && !current.activities.some(a => a.type === ActivityType.Playing)) sessions.delete(`${current.guild.id}:${current.userId}`); });
    on(Events.GuildCreate, async guild => { if (!guildAllowed(guild.id)) { logger('warn', 'unauthorized_guild_left', { guildId: guild.id }); await guild.leave(); } });
    on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
      record(guild.id, 'discord.audit', `${userLabel(entry.executor)}: ${AuditLogEvent[entry.action] || entry.action}`, entry.executorId, { actorName: userLabel(entry.executor), targetId: entry.targetId, targetName: userLabel(entry.target), reason: short(entry.reason), changes: (entry.changes || []).map(c => ({ key: c.key, old: short(JSON.stringify(c.old), 250), new: short(JSON.stringify(c.new), 250) })).slice(0, 8), auditId: entry.id });
      const change = entry.changes?.find(c => c.key === 'communication_disabled_until');
      if (entry.action === AuditLogEvent.MemberUpdate && change?.new && Date.parse(change.new) > now()) { const user = await client.users.fetch(entry.targetId); await openDefense(guild, user, entry.reason || 'Discord yetkilisi tarafından timeout uygulandı.', entry.executorId); }
    });
  }
  async function initialize() {
    if (config.dataDir) { try { const cache = JSON.parse(await readFile(join(config.dataDir, 'phishing-cache.json'), 'utf8')); feed = new Set(cache.domains); feedUpdatedAt = cache.updatedAt; } catch { /* Cold start uses custom domains until refresh. */ } }
    for (const guild of client.guilds.cache.values()) {
      if (!guildAllowed(guild.id)) { await guild.leave(); continue; }
      const s = settings(guild.id);
      if (!s.supportRoleId) continue;
      for (const item of store.listRecords(guild.id, 'ticket', 1000).filter(ticket => ticket.status === 'open')) {
        const channel = await guild.channels.fetch(item.id).catch(() => null);
        if (!channel?.permissionOverwrites) continue;
        try {
          await channel.permissionOverwrites.set(ticketOverwrites(guild.id, item.userId, s.supportRoleId), 'Pit-Stop bilet gizliliğini onar');
          let updated = item;
          if (!item.closeControlPublished) {
            await channel.send({ content: 'Bilet sahibi veya destek yetkilileri bileti kapatabilir; kanalı yalnızca Kanalları Yönet iznine sahip yetkililer silebilir.', components: [ticketControls()], allowedMentions: noMentions });
            updated = { ...updated, closeControlPublished: true };
          }
          if (!item.privacyVerifiedAt) {
            updated = { ...updated, privacyVerifiedAt: now() };
            record(guild.id, 'ticket.privacy_repaired', 'Açık destek talebinin özel kanal izinleri doğrulandı.', client.user.id, { actorName: userLabel(client.user), channelId: item.id, userId: item.userId });
          }
          if (updated !== item) store.putRecord(guild.id, 'ticket', item.id, updated);
        } catch { record(guild.id, 'ticket.repair_failed', 'Açık destek talebinin izinleri onarılamadı.', client.user.id, { actorName: userLabel(client.user), channelId: item.id }); }
      }
    }
    void refreshFeed(); timer = setInterval(() => void tick().catch(() => logger('error', 'feature_tick_failed')), 15000); timer.unref();
    refreshTimer = setInterval(() => void refreshFeed(), 15 * 60000); refreshTimer.unref();
  }
  return { commands, install, initialize, tick, processMessage, protectionStatus, publishTicket, publishFaq, openDefense, closeTicket, deleteTicket,
    close() { clearInterval(timer); clearInterval(refreshTimer); for (const [event, listener] of listeners) client.off(event, listener); sessions.clear(); },
  };
}
