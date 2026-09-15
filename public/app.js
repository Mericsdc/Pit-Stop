import { staticHosting, livePanelUrl } from './site-config.js';
import { renderRpgContent } from './rpg-view.js';

// Keep panel artwork and rendered records inside the interface. Form fields stay editable,
// but copying/cutting, drag export and the context menu are disabled across the site.
for (const type of ['copy', 'cut', 'dragstart', 'contextmenu']) {
  document.addEventListener(type, event => event.preventDefault(), { capture: true });
}
document.addEventListener('selectstart', event => {
  if (!event.target.closest?.('input, textarea, select')) event.preventDefault();
}, { capture: true });
new MutationObserver(() => {
  for (const media of document.querySelectorAll('img, video')) media.draggable = false;
}).observe(document.documentElement, { childList: true, subtree: true });
for (const media of document.querySelectorAll('img, video')) media.draggable = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { csrf: '', guild: null, guilds: [], view: 'overview', logs: [], dirty: false, me: null, crewSort: { key: 'last24hCrewRep', direction: 'desc' }, navOrder: [], panelAccess: null, faqRecords: [], reactionRoleRecords: [], editingFaqId: null };
let guildLoadVersion = 0;
const titles = { overview: 'Genel bakış', crew: 'Ekip REP takibi', boosted: 'Boosted Event takibi', faq: 'Sık sorulan sorular', music: 'Müzik istasyonu', rpg: 'Mini RPG ve ekonomi', community: 'Üyeler ve roller', reactionRoles: 'Emoji ile rol verme', responders: 'Otomatik cevaplar', protection: 'Spam ve oltalama', blacklist: 'Üye kara listesi', tickets: 'Destek ve savunma', tools: 'Hatırlatıcı ve sağlık', logs: 'Olay kayıtları', access: 'Yetkilendirme', settings: 'Bot ve sistem ayarları' };
const navGroups = { general: ['overview'], community: ['crew', 'boosted', 'faq', 'music', 'rpg'], automation: ['community', 'reactionRoles', 'responders', 'protection', 'blacklist', 'tickets', 'tools'], system: ['logs', 'access', 'settings'] };
const defaultNavOrder = Object.values(navGroups).flat();
const overviewHeightKey = 'pitstop-overview-card-height';
function savedNavOrder() {
  try {
    const value = JSON.parse(localStorage.getItem('pitstop-nav-order') || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(view => defaultNavOrder.includes(view))), ...defaultNavOrder.filter(view => !value.includes(view))] : [...defaultNavOrder];
  } catch { return [...defaultNavOrder]; }
}
function applyNavOrder() {
  const nav = $('#sidebar-nav');
  for (const [group, views] of Object.entries(navGroups)) {
    const target = $(`[data-nav-group="${group}"] .nav-items`, nav);
    for (const view of state.navOrder.filter(item => views.includes(item))) { const button = $(`[data-view="${view}"]`, nav); if (button) target.append(button); }
  }
}
function pageOrderEditor() {
  return Object.entries(navGroups).map(([group, views]) => { const ordered = state.navOrder.filter(view => views.includes(view)); return `<div class="page-order"><strong>${group === 'general' ? 'GENEL' : group === 'community' ? 'OYUN VE TOPLULUK' : group === 'automation' ? 'OTOMASYON VE MODERASYON' : 'SİSTEM YÖNETİMİ'}</strong>${ordered.map((view, index) => `<div><span>${escape(titles[view])}</span><span class="record-actions"><button type="button" class="button subtle" data-move-view="${view}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="button subtle" data-move-view="${view}" data-direction="down" ${index === ordered.length - 1 ? 'disabled' : ''}>↓</button></span></div>`).join('')}</div>`; }).join('');
}
function savedOverviewHeight() {
  const value = Number(localStorage.getItem(overviewHeightKey));
  return Number.isFinite(value) && value >= 520 && value <= 1800 ? Math.round(value) : null;
}
function applyOverviewHeight() {
  const height = savedOverviewHeight();
  if (state.view !== 'overview' || !matchMedia('(min-width: 1181px)').matches || !height) return;
  $$('.dashboard-resizable').forEach(card => { card.style.height = `${height}px`; });
}
function saveOverviewHeight(card) {
  if (!card || state.view !== 'overview' || !matchMedia('(min-width: 1181px)').matches) return;
  const height = Math.max(520, Math.min(1800, Math.round(card.getBoundingClientRect().height)));
  localStorage.setItem(overviewHeightKey, String(height));
  $$('.dashboard-resizable').forEach(item => { item.style.height = `${height}px`; });
}
state.navOrder = savedNavOrder();
const initialTheme = localStorage.getItem('pitstop-theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = initialTheme;
function updateThemeButtons() { $$('[data-theme-choice]').forEach(button => button.classList.toggle('active', button.dataset.themeChoice === document.documentElement.dataset.theme)); }
function applyAppearance(settings = state.guild?.settings) {
  const hasServerLogo = settings && Object.hasOwn(settings, 'panelLogoUrl');
  const logo = hasServerLogo ? (settings.panelLogoUrl || '/assets/login-brand.png') : (localStorage.getItem('pitstop-logo-url') || '/assets/login-brand.png');
  if (hasServerLogo) { if (settings.panelLogoUrl) localStorage.setItem('pitstop-logo-url', settings.panelLogoUrl); else localStorage.removeItem('pitstop-logo-url'); }
  for (const image of [$('#panel-logo'), $('#login-logo')].filter(Boolean)) { image.onerror = () => { image.onerror = null; image.src = '/assets/login-brand.png'; }; image.src = logo; }
  const banner = settings?.panelBannerUrl || '/assets/banner.webp';
  if ($('#hero-banner')) { $('#hero-banner').onerror = () => { $('#hero-banner').onerror = null; $('#hero-banner').src = '/assets/banner.webp'; }; $('#hero-banner').src = banner; }
  const background = settings?.panelLoginBackgroundUrl || '';
  const backgroundImage = $('#login-background-image'), backgroundVideo = $('#login-background-video');
  if (backgroundImage && backgroundVideo) {
    backgroundImage.hidden = true; backgroundVideo.hidden = true; backgroundVideo.pause(); backgroundVideo.removeAttribute('src');
    if (background) {
      let isVideo = false;
      try { isVideo = /\.(?:mp4|webm|ogg)$/iu.test(new URL(background).pathname); } catch { /* Server-side validation reports invalid URLs. */ }
      if (isVideo) { backgroundVideo.src = background; backgroundVideo.hidden = false; void backgroundVideo.play().catch(() => { backgroundVideo.hidden = true; }); }
      else { backgroundImage.onerror = () => { backgroundImage.hidden = true; }; backgroundImage.src = background; backgroundImage.hidden = false; }
    }
  }
}
function setMenuOpen(open) { document.body.classList.toggle('menu-open', open); const toggleButton = $('#menu-toggle'); if (toggleButton) { toggleButton.setAttribute('aria-expanded', String(open)); toggleButton.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç'); } if ($('#menu-backdrop')) $('#menu-backdrop').hidden = !open; }
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const check = value => value ? 'checked' : '';
const badge = (value, yes = 'Etkin', no = 'Kapalı') => `<span class="badge ${value ? 'on' : 'off'}">${value ? '●' : '○'} ${escape(value ? yes : no)}</span>`;
const number = value => Number(value || 0).toLocaleString('tr-TR');
const duration = ms => `${Math.floor((ms || 0) / 60000)}:${String(Math.floor((ms || 0) / 1000) % 60).padStart(2, '0')}`;
const uptime = seconds => seconds >= 86400 ? `${Math.floor(seconds / 86400)} gün` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} sa` : `${Math.floor(seconds / 60)} dk`;
const date = value => value ? new Date(value).toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : '—';
function greetingText() {
  const hour = new Date().getHours();
  return `${hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}, ${state.me?.user.name || ''}. Hoş geldiniz!`;
}
function roleChecks(id, selected = [], assignable = false) { return `<div id="${id}" class="role-checks">${state.guild.roles.filter(r => !assignable || r.assignable || selected.includes(r.id)).map(r => `<label><input type="checkbox" value="${escape(r.id)}" ${check(selected.includes(r.id))}> ${escape(r.name)}${assignable && !r.assignable ? ' (botun rol hiyerarşisini kontrol edin)' : ''}</label>`).join('') || '<p class="muted">Botun atayabileceği rol yok. Discord’da Pit-Stop bot rolünü atanacak rollerin üstüne taşıyın.</p>'}</div>`; }
const selectedRoles = id => $$(`#${id} input:checked`).map(input => input.value);

let noticeTimer;
function notice(message, error = false) {
  clearTimeout(noticeTimer);
  const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.hidden = !message;
  if (message) noticeTimer = setTimeout(() => { node.hidden = true; node.textContent = ''; }, error ? 8000 : 5000);
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, ...options.headers } });
  let body = {};
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try { body = await response.json(); } catch { body = {}; }
  }
  if (!response.ok) { const error = new Error(body.error || 'İşlem tamamlanamadı. Canlı panel bağlantısını kontrol edin.'); error.status = response.status; throw error; }
  return body;
}
const guildApi = (resource = '', options) => api(`/api/guilds/${state.guild.id}${resource ? `/${resource}` : ''}`, options);
function channelOptions(selected, voice = false, textOnly = false) {
  return `<option value="">Kanal seçin</option>` + state.guild.channels.filter(channel => voice ? channel.type === 2 : textOnly ? channel.type === 0 : [0, 5].includes(channel.type)).map(channel => `<option value="${escape(channel.id)}" ${selected === channel.id ? 'selected' : ''}>${voice ? '♫' : '#'} ${escape(channel.name)}</option>`).join('');
}
function roleOptions(selected, assignable = false) {
  return `<option value="">${assignable ? 'Rol seçin' : 'Herkes kullanabilir'}</option>` + state.guild.roles.filter(role => !assignable || role.assignable).map(role => `<option value="${escape(role.id)}" ${selected === role.id ? 'selected' : ''}>${escape(role.name)}</option>`).join('');
}
const standardReactionEmojis = ['✅','❌','🎮','🏁','🚗','🎵','🔔','💬','🏆','🔧','❤️','⭐','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪'];
function reactionEmojiOptions(selected = '') {
  const standard = standardReactionEmojis.map(emoji => `<option value="unicode:${emoji}" ${selected === `unicode:${emoji}` ? 'selected' : ''}>${emoji}</option>`).join('');
  const custom = (state.guild.emojis || []).map(emoji => `<option value="custom:${escape(emoji.id)}" ${selected === `custom:${emoji.id}` ? 'selected' : ''}>:${escape(emoji.name)}:</option>`).join('');
  return `<option value="">Tepki seçin</option><optgroup label="Standart emojiler">${standard}</optgroup>${custom ? `<optgroup label="Sunucu emojileri">${custom}</optgroup>` : ''}`;
}
function reactionRoleRow(mapping = {}) {
  return `<div class="reaction-role-row"><label>Tepki<select name="reaction-emoji" required>${reactionEmojiOptions(mapping.emoji || '')}</select></label><label>Verilecek rol<select name="reaction-role" required>${roleOptions(mapping.roleId || '', true)}</select></label><button type="button" class="button danger remove-reaction-role" aria-label="Emoji ve rol satırını kaldır">×</button></div>`;
}
function updateReactionRolePreview() {
  const preview = $('#reaction-role-preview');
  if (!preview) return;
  const content = $('#reaction-role-content')?.value.trim() || 'Discord mesajınız burada görünür.';
  const mappings = $$('.reaction-role-row').map(row => ({ emoji: $('[name="reaction-emoji"]', row)?.selectedOptions[0]?.textContent, role: $('[name="reaction-role"]', row)?.selectedOptions[0]?.textContent })).filter(item => item.emoji && item.role && item.emoji !== 'Tepki seçin' && item.role !== 'Rol seçin');
  preview.innerHTML = `<div class="discord-message-preview"><strong>Pit-Stop</strong><p>${escape(content)}</p><div class="reaction-preview-list">${mappings.map(item => `<span>${escape(item.emoji)} <b>1</b><small>→ ${escape(item.role)}</small></span>`).join('') || '<span class="muted">Emoji ve rol eşleştirmeleri burada görünür.</span>'}</div></div>`;
}
function renderReactionRoles() {
  return `<div class="grid-2 balanced-grid reaction-role-layout"><form id="reaction-role-form" class="card form-stack"><div class="card-header"><div><h3>Yeni rol mesajı</h3><p class="muted tiny">Mesajı yayımlayın; üyeler tepkiye tıklayınca karşılık gelen rolü alır, tepkiyi kaldırınca rol geri alınır.</p></div><span class="badge">En fazla 20 tepki</span></div><label>Yayın kanalı<select id="reaction-role-channel" required>${channelOptions('')}</select></label><label>Discord mesajı<textarea id="reaction-role-content" maxlength="1800" rows="6" required placeholder="Almak istediğiniz rolün tepkisine tıklayın."></textarea></label><div class="card-header reaction-role-heading"><div><h3>Tepki ve rol eşleştirmeleri</h3><p class="muted tiny">Her tepki ve rol bu mesajda yalnızca bir kez kullanılabilir.</p></div><button type="button" id="add-reaction-role" class="button subtle">+ Eşleştirme ekle</button></div><div id="reaction-role-mappings" class="reaction-role-mappings">${reactionRoleRow()}</div><div class="hint">Bot rolünü verilecek rollerin üstünde tutun. Botun kanalda Mesajları Görüntüle, Mesaj Gönder, Mesaj Geçmişini Oku ve Tepki Ekle izinleri bulunmalıdır.</div><div class="form-actions"><button class="button primary" type="submit">Discord’da yayımla</button></div></form><section class="card"><div class="card-header"><div><h3>Discord önizlemesi</h3><p class="muted tiny">Gerçek mesaj, seçtiğiniz tepkilerle birlikte yayımlanır.</p></div></div><div id="reaction-role-preview" class="discord-preview"></div></section><section class="card wide"><div class="card-header"><div><h3>Yayımlanmış rol mesajları</h3><p class="muted tiny">Bir yayını kaldırmak Discord mesajını ve panel kaydını birlikte siler.</p></div><span id="reaction-role-count" class="badge">${state.reactionRoleRecords.length} yayın</span></div><div id="reaction-roles-records">Yükleniyor…</div></section></div>`;
}
const toggle = (id, title, description, enabled) => `<div class="switch-row"><div><label for="${id}">${title}</label><p>${description}</p></div><input type="checkbox" id="${id}" ${check(enabled)}></div>`;
const empty = message => `<div class="empty"><span class="empty-symbol" aria-hidden="true">◇</span>${escape(message)}</div>`;

function renderOverview() {
  const { settings: s, bot, memberCount, music } = state.guild;
  const modules = [
    ['↗', 'Otomatik roller', 'Yeni üyelere seçtiğin tüm rolleri ver.', s.autoRoleEnabled],
    ['☺', 'Emoji ile rol verme', `${state.guild.reactionRoleCount || 0} rol mesajı yayında.`, (state.guild.reactionRoleCount || 0) > 0],
    ['⚔', 'Mini RPG ve ekonomi', '/çalış ve /maden ile kazan, /savaş ile yarış.', true],
    ['↙', 'Ayrılma mesajları', 'Ayrılan üyeleri seçtiğin kanala bildir.', s.leaveEnabled],
    ['⌘', 'Otomatik cevaplar', `${s.responses.length} özel ! komutu hazır.`, s.responderEnabled],
    ['♫', 'Müzik istasyonu', 'YouTube Music ve Spotify bağlantıları.', s.musicEnabled],
    ['◇', 'Üye kara listesi', 'Sunucudan ayrılan üyelerin kaydını tut.', s.blacklistOnLeave],
    ['⌁', 'Spam koruması', '3 saniyede 5 aynı mesajı engelle.', s.antiSpamEnabled],
    ['◈', 'Oltalama koruması', 'Güncel alan adı listesiyle zararlı bağlantıları engelle.', s.antiPhishingEnabled],
    ['□', 'Destek biletleri', 'Üye ve yetkililer için özel destek kanalları.', s.ticketEnabled],
    ['♧', 'Savunma odaları', 'Moderasyon işlemleri için kayıtlı özel görüşmeler.', s.defenseEnabled],
    ['◷', 'Hatırlatıcılar', '/hatırlat ile kalıcı kişisel notlar.', true],
    ['☀', 'Sağlık asistanı', 'Katılmayı seçen üyelere mola hatırlatmaları.', s.healthEnabled],
    ['🏁', 'Ekip REP takibi', 'NightRiderz üyelerinin anlık ve günlük değişimini karşılaştır.', true],
    ['?', 'Sık sorulan sorular', 'Hazır cevapları seçilen Discord kanalına yayımla.', s.faqEnabled],
  ];
  const active = modules.filter(([, , , enabled]) => enabled).length;
  return `<div class="stats">
    <div class="card stat"><div class="stat-label">Toplam üye <span class="stat-icon">♧</span></div><div class="stat-value">${number(memberCount)}</div><div class="stat-foot">Sunucunun güncel üye sayısı</div></div>
    <div class="card stat"><div class="stat-label">Bot gecikmesi <span class="stat-icon">ϟ</span></div><div class="stat-value">${number(bot.ping)} <small class="tiny muted">ms</small></div><div class="stat-foot">${bot.ready ? 'Discord bağlantısı aktif' : 'Discord’a bağlanıyor'}</div></div>
    <div class="card stat"><div class="stat-label">Etkin modüller <span class="stat-icon">⌘</span></div><div class="stat-value">${active}<small class="tiny muted"> / ${modules.length}</small></div><div class="stat-foot">Sunucuna özel otomasyonlar</div></div>
    <div class="card stat"><div class="stat-label">Çalışma süresi <span class="stat-icon">◷</span></div><div class="stat-value">${uptime(bot.uptime)}</div><div class="stat-foot">Son başlatılmadan bu yana</div></div>
  </div><div class="grid-2 overview-grid"><section class="card dashboard-resizable" data-dashboard-size><div class="card-header"><h3>Sunucunun pit ekibi</h3><span class="badge">${modules.length} modül</span></div>
  ${modules.map(([icon, name, description, enabled]) => `<div class="module-row"><div class="module-name"><span class="module-icon" aria-hidden="true">${icon}</span><div><strong>${name}</strong><p>${description}</p></div></div>${badge(enabled)}</div>`).join('')}
  <div class="quick-actions"><button class="button subtle" data-go="community">Üye ayarlarını düzenle ↗</button></div></section>
  <section class="card dashboard-resizable" data-dashboard-size><div class="card-header"><h3>${music.current ? 'Şimdi garajda çalıyor' : 'En son garajda çalınan'}</h3>${badge(music.connected, 'Bağlı', 'Beklemede')}</div>${musicCover(music.current || music.lastPlayed)}<div class="now-playing"><h3>${escape((music.current || music.lastPlayed)?.title || 'Henüz bir parça çalmıyor')}</h3><p>${escape((music.current || music.lastPlayed)?.author || 'Ses kanalına katıl, müzik istasyonundan bir parça seç.')}</p></div><div class="quick-actions"><button class="button primary" data-go="music">Müzik istasyonunu aç ♫</button></div></section>
  <section class="card wide"><div class="card-header"><h3>Son hareketler</h3><button class="button subtle" data-go="logs">Tüm kayıtlar ↗</button></div><div id="recent-logs" class="muted">Kayıtlar yükleniyor…</div></section></div>`;
}

function renderRpg() {
  return `<section class="card"><div class="card-header"><div><h3>Garajdan maceraya</h3><p class="muted">Altın kazan, ekipmanını güçlendir ve sunucunun sıralamasında yüksel.</p></div><span class="badge">/rpg-rehber</span></div><p class="muted tiny">Oyun komutlarını Discord’da kullanın. Bu sayfada güncel eşya kataloğunu, canavarları ve ilk 10 oyuncuyu takip edebilirsiniz.</p></section><form id="rpg-settings-form" class="card form-stack"><h3>Başarı duyuruları</h3><p class="muted tiny">Boss zaferleri ve üretilen efsanevi eşyalar seçilen kanalda kutlanır. Kanal seçmezseniz yalnızca olay kayıtlarına yazılır.</p><label>Duyuru kanalı<select id="rpg-announcement-channel">${channelOptions(state.guild.settings.rpgAnnouncementChannelId)}</select></label><div class="form-actions"><button type="submit" class="button primary">Duyuru ayarını kaydet</button></div></form><div id="rpg-content"><div class="loading">RPG bilgileri yükleniyor…</div></div>`;
}
function rpgBody(data) { return renderRpgContent(data, { escape, number, date, empty }); }
let rpgLoading = false;
async function loadRpg() {
  if (rpgLoading) return;
  rpgLoading = true;
  const guildId = state.guild.id;
  try {
    const data = await guildApi('rpg');
    if (state.guild?.id !== guildId || state.view !== 'rpg' || !$('#rpg-content')) return;
    $('#rpg-content').innerHTML = rpgBody(data);
  } catch (error) {
    if (state.guild?.id === guildId && state.view === 'rpg' && $('#rpg-content')) $('#rpg-content').innerHTML = `<div class="hint">${escape(error.message)} Üstteki Yenile düğmesiyle tekrar deneyin.</div>`;
  } finally { rpgLoading = false; }
}

function renderCommunity() {
  const s = state.guild.settings;
  return `<form id="community-form"><div class="grid-2"><section class="card form-stack">${toggle('auto-role-enabled', 'Otomatik roller', 'Sunucuya katılan üyelere seçtiğin tüm rolleri ver.', s.autoRoleEnabled)}<div class="field"><label>Verilecek roller</label>${roleChecks('auto-role-ids', s.autoRoleIds || [], true)}<small>Birden fazla rol işaretleyebilirsin.</small></div><div class="hint">Botun rolünü verilecek rollerin üzerinde tutun ve Rolleri Yönet iznini açın.</div></section>
  <section class="card form-stack">${toggle('leave-enabled', 'Ayrılma mesajları', 'Sunucudan ayrılan üyeler için mesaj gönder.', s.leaveEnabled)}<div class="field"><label for="leave-channel">Bildirim kanalı</label><select id="leave-channel">${channelOptions(s.leaveChannelId)}</select></div><div class="field"><label for="leave-message">Ayrılma mesajı</label><textarea id="leave-message" maxlength="1000" rows="4">${escape(s.leaveMessage)}</textarea><small>Değişkenler: {user}, {username}, {server}, {memberCount}</small></div><div class="hint"><strong>Önizleme</strong><p id="leave-preview"></p></div></section></div><div class="form-actions"><span class="muted tiny">Değişiklikler kaydettikten sonra uygulanır.</span><button class="button primary" type="submit">Değişiklikleri kaydet</button></div></form>`;
}
function responseRow(response = { trigger: '', reply: '' }) {
  return `<div class="response-row"><div class="field trigger-field"><label>Komut adı<input name="trigger" value="${escape(response.trigger)}" placeholder="kurallar" maxlength="32" required></label><small>Başına ! eklemeyin; bot otomatik olarak !komut biçiminde dinler.</small></div><div class="field reply-field"><label>Botun cevabı<textarea name="reply" placeholder="Sunucu kurallarını #kurallar kanalında bulabilirsin." maxlength="1800" required>${escape(response.reply)}</textarea></label></div><button type="button" class="button danger remove-response" aria-label="Bu otomatik cevabı kaldır">×</button></div>`;
}
function renderResponders() {
  const s = state.guild.settings;
  return `<form id="responders-form"><section class="card">${toggle('responder-enabled', 'Otomatik cevaplar', 'Üyeler ünlem işaretiyle başlayan tanımlı komutu yazdığında belirlediğiniz metinle cevap verir.', s.responderEnabled)}<div class="response-toolbar"><h3>Özel cevapların</h3><input id="response-search" type="search" placeholder="Cevaplarda ara" aria-label="Otomatik cevaplarda ara"><button type="button" id="add-response" class="button subtle">+ Cevap ekle</button></div><div class="responses" id="responses">${s.responses.map(responseRow).join('')}</div><p class="muted tiny" id="responses-empty" ${s.responses.length ? 'hidden' : ''}>Henüz özel bir cevap yok. İlk komutunu ekleyerek başla.</p><div class="hint">Komut alanına <span class="inline-code">kurallar</span> yazarsanız üyeler <span class="inline-code">!kurallar</span> yazarak cevabı alır. Büyük/küçük harf fark etmez. Diğer bot komutlarını <span class="inline-code">/</span> ile kullanabilirsiniz.</div></section><div class="form-actions"><button class="button primary" type="submit">Cevapları kaydet</button></div></form>`;
}
function musicCover(track) {
  return track?.artworkUrl
    ? `<div class="music-cover"><img src="${escape(track.artworkUrl)}" alt="${escape(track.title || 'Şarkı')} kapak görseli" referrerpolicy="no-referrer" draggable="false"></div>`
    : '<div class="record" aria-hidden="true"><span>•</span></div>';
}
function renderMusic() {
  const s = state.guild.settings, m = state.guild.music;
  return `<div class="music-layout"><section class="card player"><div class="card-header"><h3>Oynatıcı</h3>${badge(m.available, 'Müzik bağlantısı hazır', 'Bağlantı bekleniyor')}</div>${musicCover(m.current || m.lastPlayed)}<div class="now-playing"><h3>${escape((m.current || m.lastPlayed)?.title || 'Sıradaki parça senden')}</h3><p>${escape((m.current || m.lastPlayed)?.author || 'YouTube, YouTube Music veya Spotify bağlantısı ekle.')}</p>${m.current ? `<span class="badge">${m.paused ? 'Duraklatıldı' : 'Çalıyor'} · ${duration(m.current.duration)}</span>` : m.lastPlayed ? '<span class="badge">En son çalınan</span>' : ''}</div><div class="player-controls"><button class="button" data-control="${m.paused ? 'resume' : 'pause'}">${m.paused ? '▶ Devam' : 'Ⅱ Duraklat'}</button><button class="button" data-control="skip">Sonraki ⏭</button><button class="button danger" data-control="stop">■ Bitir</button></div><form id="volume-form" class="volume-row"><label for="volume">Ses</label><input id="volume" type="range" min="1" max="100" value="${Number(m.volume || s.musicVolume)}"><output id="volume-value">${Number(m.volume || s.musicVolume)}%</output><button class="button subtle">Uygula</button></form><div class="hint">Önce Discord’da bir ses kanalına katılın. Oynatıcıyı kontrol etmek için botla aynı kanalda olun.</div></section>
  <section class="card"><div class="card-header"><h3>Sıraya parça ekle</h3><span class="badge">YouTube Music</span></div><form id="play-form" class="form-stack"><div class="field"><label for="query">Şarkı adı veya bağlantı</label><div class="search-row"><input id="query" required maxlength="500" placeholder="Sanatçı, şarkı veya playlist bağlantısı"><button class="button primary" type="submit">+ Sıraya ekle</button></div></div></form><div class="hint">Spotify bağlantıları parça bilgisi için kullanılır; ses, YouTube üzerinden eşleştirilir. ${m.spotifyConfigured ? 'Spotify bağlantısı ayarlı.' : 'Spotify bağlantıları için sunucuda Spotify API ayarları gerekir.'}</div><div class="card-header response-toolbar"><h3>Çalma sırası</h3><span class="badge">${m.queue?.length || 0} parça</span></div>${m.queue?.length ? `<ol class="queue-list">${m.queue.map((track, index) => `<li class="queue-item"><span class="index">${String(index + 1).padStart(2, '0')}</span><div><strong>${escape(track.title)}</strong><small>${escape(track.author)}</small></div><span class="muted tiny">${duration(track.duration)}</span></li>`).join('')}</ol>` : empty('Kuyruk boş. İlk parçanı ekle.')}</section>
  </div>`;
}
const logTypeNames = { 'settings.updated': 'Ayar değişikliği', 'member.join': 'Üye katıldı', 'member.leave': 'Üye ayrıldı', 'autorole.assigned': 'Otomatik rol', 'autorole.error': 'Rol hatası', 'leave.error': 'Ayrılma mesajı hatası', 'responder.sent': 'Otomatik cevap', 'command.executed': 'Komut işlendi', 'command.failed': 'Komut hatası', 'message.delete': 'Mesaj silindi', 'message.bulk_delete': 'Toplu silme', 'member.roles_update': 'Rol değişikliği', 'member.timeout_update': 'Zaman aşımı değişikliği', 'music': 'Müzik işlemi', 'music_error': 'Müzik hatası', 'community.error': 'Topluluk hatası' };
function logTable(logs) {
  return !logs.length ? empty('Henüz olay kaydı yok. Yeni hareketler burada görünür.') : `<div class="table-wrap"><table><thead><tr><th>TARİH / SAAT</th><th>KULLANICI / YETKİLİ</th><th>OLAY VE AYRINTI</th></tr></thead><tbody>${logs.map(log => `<tr><td class="time" data-label="TARİH / SAAT">${date(log.createdAt)}</td><td data-label="KULLANICI / YETKİLİ"><strong>${escape(log.actorName || log.details?.actorName || (log.actorId ? 'İsim çözümlenemedi' : 'Sistem / yetkili bilgisi yok'))}</strong><small class="muted">${escape(log.actorId || '')}</small></td><td class="log-message" data-label="OLAY VE AYRINTI"><span class="badge">${escape(logTypeNames[log.type] || log.type)}</span><p>${escape(log.message)}</p>${log.details?.input ? `<p><strong>Yazılan:</strong> ${escape(log.details.input)}</p><p><strong>Botun yanıtı:</strong> ${escape(log.details.reply)}</p>` : ''}${log.details?.query ? `<p><strong>Müzik isteği:</strong> ${escape(log.details.query)}</p>` : ''}<details><summary>Tüm ayrıntılar</summary><pre>${escape(JSON.stringify(log.details || {}, null, 2))}</pre></details></td></tr>`).join('')}</tbody></table></div>`;
}
function renderLogs() { return `<section class="card"><div class="log-tools"><label for="log-search" class="sr-only">Kayıtlarda ara</label><input id="log-search" type="search" placeholder="Kullanıcı veya olay ara"><label for="log-type" class="sr-only">Olay türü</label><select id="log-type"><option value="">Tüm olaylar</option>${Object.entries(logTypeNames).map(([value, label]) => `<option value="${escape(value)}">${label}</option>`).join('')}</select><button class="button subtle" id="reload-logs">↻ Kayıtları yenile</button><span class="muted tiny">Son 30 gün · En fazla 10.000 kayıt</span></div><div id="log-table" class="muted">Kayıtlar yükleniyor…</div><div class="form-actions"><button id="more-logs" class="button subtle" hidden>Daha eski kayıtlar</button></div></section>`; }
function renderBoosted() {
  const s = state.guild.settings, event = state.guild.boostedEvent || {};
  const progress = event.event?.endsAt ? `<section class="boosted-progress" data-ends-at="${Number(event.event.endsAt)}"><div class="boosted-progress-head"><strong>30 dakikalık yarış süresi</strong><span data-boosted-progress-text>Hesaplanıyor…</span></div><div class="boosted-progress-track" role="progressbar" aria-label="Boosted Event kalan süre" aria-valuemin="0" aria-valuemax="100"><span data-boosted-progress-fill></span></div></section>` : '';
  return `<form id="boosted-form" class="card form-stack"><div class="card-header"><div><h3>Boosted Event takibi</h3><p class="muted tiny">NightRiderz canlı haritası saat ve yarım saat güncellemelerinden sonra kontrol edilir.</p></div>${badge(s.boostedEventEnabled)}</div>${toggle('boosted-event-enabled', 'Etkinlik duyuruları', 'Yeni yarış bulunduğunda seçilen kanala bağlantı, sınıf ve bitiş saatiyle gönder; sınıf simgesini mesaja tepki olarak ekler.', s.boostedEventEnabled)}<label>Bildirim kanalı<select id="boosted-event-channel">${channelOptions(s.boostedEventChannelId || event.channelId)}</select></label>${progress}<p class="muted tiny">Son kontrol: ${date(event.checkedAt)}${event.event ? ` · <a href="${escape(event.event.url || `https://nightriderz.world/leaderboard/${event.event.id}`)}" target="_blank" rel="noopener noreferrer">${escape(event.event.name)}</a> · ${escape(event.event.className)}${event.event.endsAt ? ` · Bitiş: ${date(event.event.endsAt)}` : ''}` : ''}</p>${event.error ? `<p class="hint">${escape(event.error)}</p>` : ''}<div class="form-actions"><button type="button" class="button subtle" id="refresh-boosted-event">Şimdi kontrol et ve bildir</button><button class="button primary">Ayarları kaydet</button></div></form>`;
}
function updateBoostedProgress() {
  const progress = $('.boosted-progress');
  if (!progress) return;
  const total = 30 * 60_000, remaining = Math.max(0, Number(progress.dataset.endsAt) - Date.now());
  const percent = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
  const fill = progress.querySelector('[data-boosted-progress-fill]'), label = progress.querySelector('[data-boosted-progress-text]');
  if (fill) fill.style.width = `${percent.toFixed(2)}%`;
  if (label) label.textContent = remaining ? `%${Math.round(percent)} · ${Math.ceil(remaining / 60_000)} dakika sonra değişecek` : '%100 · Yeni yarış kontrol ediliyor';
  progress.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(Math.round(percent)));
}

function settingsLinks() {
  const cards = [['community','Üyeler ve roller','Otomatik roller ve ayrılma mesajları'],['reactionRoles','Emoji ile rol verme','Tepki ve rol eşleştirmeleri'],['responders','Otomatik cevaplar','! komutlarına verilen yanıtlar'],['protection','Spam ve oltalama','Koruma eşikleri ve alan adları'],['blacklist','Üye kara listesi','Ayrılan ve elle eklenen üyeler'],['tickets','Destek ve savunma','Bilet ve özel savunma odaları'],['tools','Hatırlatıcı ve sağlık','Sağlık asistanı ayarları'],['faq','Sık sorulan sorular','SSS yayını ve içerikleri'],['music','Müzik istasyonu','Müzik ayarları ve oynatıcı'],['access','Yetkilendirme','Panel ve müzik erişimleri']];
  return `<section class="card wide"><div class="card-header"><div><h3>Bağımsız ayar sayfaları</h3><p class="muted tiny">Her ayar yalnızca ait olduğu sayfadan değiştirilir.</p></div></div><div class="settings-links">${cards.map(([view,title,text]) => `<button type="button" class="summary-link" data-go="${view}"><strong>${title}</strong><span>${text}</span><b>→</b></button>`).join('')}</div></section>`;
}

function renderSettingsBase() {
  const s = state.guild.settings, perms = state.guild.bot.permissions;
  const commands = [['/panel-giris', 'Tek kullanımlık güvenli panel giriş kodu üret.'], ['/hatırlat · /hatırlatıcılar', 'Kişisel hatırlatma oluştur, listele veya iptal et.'], ['/healthcare', 'Mola hatırlatmalarına katıl veya kapat.'], ['/bilet-kapat', 'Destek biletini kapat.'], ['/uyar · /savunma-yanıt', 'Üyeyi uyar veya özel savunmaya yanıt ver.'], ['/yardim', 'Tüm komutları ve kullanımını göster.'], ['/clear · /temizle', 'Adet verilmezse tüm kanalı, verilirse son 1–100 mesajı temizle.'], ['/play · /pause · /skip · /stop', 'Müzik istasyonunu yönet.']];
  const active = [['Otomatik rol',s.autoRoleEnabled],['Emoji ile rol',state.guild.reactionRoleCount > 0],['Ayrılma mesajı',s.leaveEnabled],['Otomatik cevap',s.responderEnabled],['Müzik',s.musicEnabled],['Spam',s.antiSpamEnabled],['Oltalama',s.antiPhishingEnabled],['Bilet',s.ticketEnabled],['Savunma',s.defenseEnabled],['Sağlık',s.healthEnabled],['Boosted Event',s.boostedEventEnabled],['SSS',s.faqEnabled]];
  commands.push(['/çalış · /maden', 'Sanal altın ve XP kazan. Çalışma 30, maden 15 dakikada bir kullanılabilir.'], ['/mağaza · /satın-al · /profil', 'Ekipman satın al ve karakterini görüntüle. En güçlü kılıç ve zırh otomatik kuşanılır.'], ['/savaş · /sıralama', '5 dakikada bir zarla canavar savaşı; sunucu sıralaması XP, galibiyet ve altına göre hesaplanır.']);
  const guildOptions = state.guilds.map(guild => `<option value="${escape(guild.id)}" ${guild.id === state.guild.id ? 'selected' : ''}>${escape(guild.name)}</option>`).join('');
  return `<div class="grid-2 settings-grid">
    <section class="card form-stack"><div><h3>Yönetilen Discord sunucusu</h3><p class="muted tiny">Panelde ayarlarını değiştirmek istediğiniz sunucuyu seçin.</p></div><label for="guild-select">Sunucu<select id="guild-select">${guildOptions}</select></label></section>
    <form id="settings-form" class="card form-stack"><div><h3>Discord kayıt kanalı</h3><p class="muted tiny">Panel kayıtlarına ek olarak Discord’a olay özeti gönderir.</p></div><label for="log-channel">Kayıt kanalı<select id="log-channel">${channelOptions(s.logChannelId)}</select></label><div class="form-actions"><button class="button primary">Kayıt kanalını kaydet</button></div></form>
    <form id="appearance-form" class="card form-stack"><div><h3>Panel görselleri ve giriş arka planı</h3><p class="muted tiny">HTTPS adresi kullanın. Giriş arka planı resim, GIF, MP4, WebM veya OGG olabilir; boş alan siyah arka plana döner.</p></div><label for="panel-logo-url">Logo görseli adresi<input id="panel-logo-url" type="url" maxlength="1000" placeholder="https://..." value="${escape(s.panelLogoUrl || '')}"></label><label for="panel-banner-url">Genel bakış banner adresi<input id="panel-banner-url" type="url" maxlength="1000" placeholder="https://..." value="${escape(s.panelBannerUrl || '')}"></label><label for="panel-login-background-url">Giriş ekranı arka plan adresi<input id="panel-login-background-url" type="url" maxlength="1000" placeholder="https://.../garaj.webp veya garaj.mp4" value="${escape(s.panelLoginBackgroundUrl || '')}"></label><div class="form-actions"><button type="button" id="reset-appearance" class="button subtle">Varsayılana dön</button><button class="button primary">Görselleri kaydet</button></div></form>
    <section class="card"><h3>Bot izinlerinin durumu</h3>${[['manageRoles','Rolleri Yönet'],['manageMessages','Mesajları Yönet'],['addReactions','Tepki Ekle'],['connect','Bağlan'],['speak','Konuş'],['moderateMembers','Zaman Aşımı'],['viewAuditLog','Denetim Kaydı'],['manageChannels','Kanalları Yönet'],['createPrivateThreads','Özel İleti Dizisi'],['manageThreads','İleti Dizilerini Yönet']].map(([key,label]) => `<div class="permission"><span>${label}</span>${badge(perms[key], 'Var', 'Eksik')}</div>`).join('')}</section>
    <section class="card"><h3>Genel modül durumları</h3><div class="module-status-grid">${active.map(([name,on]) => `<div><span>${name}</span>${badge(on)}</div>`).join('')}</div></section>
    <section class="card"><h3>Sistem ve bağlantı bilgileri</h3><div class="permission"><span>Discord</span>${badge(state.guild.bot.ready,'Bağlı','Bağlantı yok')}</div><div class="permission"><span>Veritabanı</span>${badge(true,'Bağlı','Hata')}</div><div class="permission"><span>Müzik servisi</span>${badge(state.guild.music.available,'Hazır','Bekliyor')}</div><div class="permission"><span>Gecikme</span><strong>${number(state.guild.bot.ping)} ms</strong></div><div class="permission"><span>Çalışma süresi</span><strong>${uptime(state.guild.bot.uptime)}</strong></div></section>
    ${state.me.installationOwner ? `<form id="install-form" class="card wide form-stack"><h3>İzin verilen kurulum sunucuları</h3><label>Sunucu kimlikleri<textarea id="allowed-guilds" rows="4" required></textarea></label><p class="muted tiny">Ana sunucu listede kalmalıdır. Bu listeyi yalnızca bot sahibi düzenleyebilir.</p><div class="form-actions"><button class="button primary">Kurulum izinlerini kaydet</button></div></form>` : ''}
    ${settingsLinks()}
    <section class="card wide"><div class="card-header"><div><h3>Sayfa sırası</h3><p class="muted tiny">Sayfaları kendi menü grubu içinde taşıyabilirsiniz.</p></div><button type="button" class="button subtle" id="reset-overview-height">Genel bakış boyutunu sıfırla</button></div>${pageOrderEditor()}</section>
    <section class="card wide"><div class="card-header"><h3>Komut rehberi</h3><span class="badge">/ komutları</span></div><div class="command-list">${commands.map(([name,desc]) => `<div class="command-item"><code>${name}</code><p>${desc}</p></div>`).join('')}</div></section>
  </div>`;
}

function renderSettings() { return renderSettingsBase(); }

function renderFaq() {
  const s = state.guild.settings;
  return `<div class="grid-2 balanced-grid"><form id="faq-settings-form" class="card form-stack">${toggle('faq-enabled', 'Sık sorulan sorular', 'Panelden hazırlanan içerikleri seçilen Discord kanalına yayımla.', s.faqEnabled)}<label>SSS yayın kanalı<select id="faq-channel">${channelOptions(s.faqChannelId)}</select></label><div class="form-actions"><button class="button primary">Yayın ayarlarını kaydet</button></div></form><form id="faq-form" class="card form-stack"><div><h3 id="faq-form-title">Yeni soru ve cevap</h3><p class="muted tiny">Önizlemeyi kontrol edin; taslak kaydedebilir veya Discord’a yayımlayabilirsiniz. Yinelenen sorular reddedilir.</p></div><label>Soru<input id="faq-question" required maxlength="300" placeholder="Turnuvalara nasıl katılabilirim?"></label><label>Cevap<textarea id="faq-answer" required maxlength="1800" rows="7"></textarea></label><div id="faq-preview" class="discord-preview"><strong>Pit-Stop · Sık sorulan sorular</strong><p>Soru ve cevap önizlemesi burada görünür.</p></div><div class="form-actions"><button type="button" id="cancel-faq-edit" class="button subtle" hidden>Düzenlemeyi iptal et</button><button class="button subtle" name="faq-action" value="draft">Taslak olarak kaydet</button><button class="button primary" name="faq-action" value="publish">Discord kanalına yayımla</button></div></form><section class="card wide"><div class="card-header"><h3>SSS kayıtları</h3><input id="records-search" type="search" placeholder="Soru veya cevap ara" aria-label="SSS kayıtlarında ara"></div><div id="faqs-records">Yükleniyor…</div></section></div>`;
}

const signed = value => `${Number(value || 0) > 0 ? '+' : ''}${number(value)}`;
function crewTrend(member, comparisonAvailable) {
  if (!comparisonAvailable) return '<span class="trend neutral" title="Dünkü kayıt henüz oluşmadı" aria-label="Dünkü kayıt henüz oluşmadı">• Karşılaştırma bekleniyor</span>';
  if (Number(member.dailyCrewRep) > 0) return `<span class="trend up" title="Düne göre REP kazandı" aria-label="Düne göre REP kazandı">↑ ${signed(member.dailyCrewRep)}</span>`;
  return `<span class="trend down" title="Bugün REP kazanmadı" aria-label="Bugün REP kazanmadı">↓ ${signed(member.dailyCrewRep)}</span>`;
}
function crewBodyLegacy(crew) {
  if (!crew?.members?.length) return `<div class="empty"><span class="empty-symbol">◇</span>${escape(crew?.error || 'Ekip verileri hazırlanıyor.')}</div>`;
  const direction = state.crewSortDirection;
  const members = [...crew.members].sort((left, right) => {
    const delta = Number(left.dailyCrewRep || 0) - Number(right.dailyCrewRep || 0);
    if (delta) return direction === 'asc' ? delta : -delta;
    return Number(right.crewRep || 0) - Number(left.crewRep || 0);
  });
  const sortArrow = direction === 'asc' ? '↑' : '↓';
  const comparisonText = crew.comparisonAvailable
    ? `${escape(crew.referenceDate)} tarihindeki son kayıtla karşılaştırılıyor.`
    : 'Dünkü kayıt oluştuğunda günlük karşılaştırma otomatik başlayacak.';
  return `<div class="stats"><div class="card stat"><div class="stat-label">Ekibin toplam REP'i</div><div class="stat-value">${number(crew.crewRep)}</div><div class="stat-foot">Güncel toplam</div></div><div class="card stat"><div class="stat-label">Bugünkü REP</div><div class="stat-value">${signed(crew.dailyCrewRep)}</div><div class="stat-foot">Dünkü son kayda göre</div></div><div class="card stat"><div class="stat-label">Bugünkü etkinlik</div><div class="stat-value">${signed(crew.dailyEvents)}</div><div class="stat-foot">Tamamlanan etkinlik farkı</div></div><div class="card stat"><div class="stat-label">Takip edilen üye</div><div class="stat-value">${number(crew.members.length)}</div><div class="stat-foot">Ekip kadrosu</div></div></div>${crew.error || crew.rosterError ? `<div class="notice error">${escape(crew.error || crew.rosterError)}</div>` : ''}<section class="card"><div class="card-header"><div><h3>Üye karşılaştırması</h3><p class="muted tiny">Son yenileme: ${date(crew.updatedAt)} · ${comparisonText}</p></div><a class="button subtle" href="${escape(crew.sourceUrl)}" target="_blank" rel="noopener noreferrer">Kaynağı aç ↗</a></div><div class="crew-legend" aria-label="REP karşılaştırma açıklaması"><span class="trend up">↑ Yeşil: düne göre REP kazandı</span><span class="trend down">↓ Kırmızı: bugün REP kazanmadı</span></div><div class="table-wrap"><table><thead><tr><th>ÜYE</th><th>EKİP REP'İ</th><th><button type="button" class="table-sort" data-crew-sort aria-label="Bugünkü REP değerine göre ${direction === 'asc' ? 'büyükten küçüğe' : 'küçükten büyüğe'} sırala">BUGÜNKÜ REP <span aria-hidden="true">${sortArrow}</span></button></th><th>SON GİRİŞ</th><th>TAMAMLANAN ETKİNLİKLER</th><th>BUGÜNKÜ ETKİNLİK</th><th>SÜRÜCÜ PUANI</th><th>BUGÜNKÜ PUAN</th></tr></thead><tbody>${members.map(member => `<tr><td><strong>${escape(member.name)}</strong><small class="muted">Seviye ${number(member.level)}</small></td><td>${number(member.crewRep)}</td><td>${crewTrend(member, crew.comparisonAvailable)}</td><td class="time">${escape(member.lastLogin || '—')}</td><td>${number(member.eventsCompleted)}</td><td>${signed(member.dailyEvents)}</td><td>${number(member.driverScore)}</td><td>${signed(member.dailyDriverScore)}</td></tr>`).join('')}</tbody></table></div><p class="muted tiny crew-source">${crew.exactRoster ? 'Üye listesi NightRiderz Üyeler bölümünden canlı alındı.' : 'Üye listesi son doğrulanan ekip kadrosundan, profil alanları NightRiderz API üzerinden canlı alındı.'}${crew.profileFailures ? ` ${number(crew.profileFailures)} profil son başarılı değeri korudu.` : ''}</p></section>`;
}
function instantTrend(member) {
  const value = Number(member.last24hCrewRep || 0);
  if (value > 0) return `<span class="trend up" title="Son 24 saatte REP kazandı">↑ ${signed(value)}</span>`;
  return `<span class="trend down" title="Son 24 saatte REP kazanmadı">↓ ${signed(value)}</span>`;
}
function crewSortButton(key, label) {
  const active = state.crewSort.key === key, arrow = active ? (state.crewSort.direction === 'asc' ? '↑' : '↓') : '↕';
  return `<button type="button" class="table-sort" data-crew-sort="${key}" aria-label="${escape(label)} sütununa göre sırala">${escape(label)} <span aria-hidden="true">${arrow}</span></button>`;
}
function crewSortValue(member, key) {
  if (key === 'name') return String(member.name || '').toLocaleLowerCase('tr-TR');
  if (key === 'lastLogin') {
    const parsed = Date.parse(String(member.lastLogin || '').replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number(member[key] || 0);
}
function crewBody(crew) {
  if (!crew?.members?.length) return `<div class="empty"><span class="empty-symbol">◇</span>${escape(crew?.error || 'Ekip verileri hazırlanıyor.')}</div>`;
  const { key, direction } = state.crewSort;
  const members = [...crew.members].sort((left, right) => {
    const leftValue = crewSortValue(left, key), rightValue = crewSortValue(right, key);
    const delta = typeof leftValue === 'string' ? leftValue.localeCompare(rightValue, 'tr') : leftValue - rightValue;
    if (delta) return direction === 'asc' ? delta : -delta;
    return String(left.name).localeCompare(String(right.name), 'tr');
  });
  const comparisonText = crew.comparisonAvailable ? (crew.referenceDate === crew.date ? 'Bugünün ilk kaydıyla karşılaştırılıyor.' : `${escape(crew.referenceDate)} tarihindeki son kayıtla karşılaştırılıyor.`) : 'İlk karşılaştırma kaydı hazırlanıyor.';
  const nextRefreshAt = crew.nextRefreshAt || (Number(crew.updatedAt || 0) + 3 * 60 * 60_000);
  return `<div class="stats crew-stats"><div class="card stat"><div class="stat-label">Toplam REP</div><div class="stat-value">${number(crew.crewRep)}</div><div class="stat-foot">Son kayıtlı ekip toplamı</div></div><div class="card stat"><div class="stat-label">Anlık REP</div><div class="stat-value">${signed(crew.last24hCrewRep ?? crew.instantCrewRep)}</div><div class="stat-foot">Son 24 saatte kazanılan</div></div><div class="card stat"><div class="stat-label">Bugünkü REP</div><div class="stat-value">${signed(crew.dailyCrewRep)}</div><div class="stat-foot">Günün ilk kaydına göre</div></div><div class="card stat"><div class="stat-label">Aylık REP</div><div class="stat-value">${signed(crew.monthlyCrewRep)}</div><div class="stat-foot">Ayın ilk kaydına göre</div></div><div class="card stat"><div class="stat-label">Bugünkü etkinlik</div><div class="stat-value">${signed(crew.dailyEvents)}</div><div class="stat-foot">Tamamlanan etkinlik farkı</div></div><div class="card stat"><div class="stat-label">Takip edilen üye</div><div class="stat-value">${number(crew.members.length)}</div><div class="stat-foot">Yöneticiler ve üyeler</div></div></div>${crew.error || crew.rosterError ? `<div class="notice error">${escape(crew.error || crew.rosterError)}</div>` : ''}<section class="card crew-table-card"><div class="card-header"><div><h3>Üye karşılaştırması</h3><p class="muted tiny">Son yenileme: ${date(crew.updatedAt)} · Sonraki otomatik yenileme: ${date(nextRefreshAt)} · ${comparisonText}</p></div><a class="button subtle" href="${escape(crew.sourceUrl)}" target="_blank" rel="noopener noreferrer">Kaynağı aç ↗</a></div><div class="crew-legend"><span class="trend up">↑ Yeşil: REP kazandı</span><span class="trend down">↓ Kırmızı: REP kazanmadı</span><span class="trend neutral">Anlık REP: son 24 saat</span></div><div class="table-wrap"><table><thead><tr><th>${crewSortButton('name','ÜYE')}</th><th>${crewSortButton('crewRep','TOPLAM REP')}</th><th>${crewSortButton('last24hCrewRep','ANLIK REP')}</th><th>${crewSortButton('dailyCrewRep','BUGÜNKÜ REP')}</th><th>${crewSortButton('monthlyCrewRep','AYLIK REP')}</th><th>${crewSortButton('lastLogin','SON GİRİŞ')}</th><th>${crewSortButton('eventsCompleted','TAMAMLANAN ETKİNLİKLER')}</th><th>${crewSortButton('dailyEvents','BUGÜNKÜ ETKİNLİK')}</th><th>${crewSortButton('driverScore','SÜRÜCÜ PUANI')}</th><th>${crewSortButton('dailyDriverScore','BUGÜNKÜ PUAN')}</th></tr></thead><tbody>${members.map(member => `<tr><td data-label="Üye"><strong>${escape(member.name)}</strong><small class="muted">Seviye ${number(member.level)}</small></td><td data-label="Toplam REP">${number(member.crewRep)}</td><td data-label="Anlık REP">${instantTrend(member)}</td><td data-label="Bugünkü REP">${crewTrend(member, crew.comparisonAvailable)}</td><td data-label="Aylık REP">${signed(member.monthlyCrewRep)}</td><td data-label="Son giriş" class="time">${escape(member.lastLogin || '—')}</td><td data-label="Tamamlanan etkinlikler">${number(member.eventsCompleted)}</td><td data-label="Bugünkü etkinlik">${signed(member.dailyEvents)}</td><td data-label="Sürücü puanı">${number(member.driverScore)}</td><td data-label="Bugünkü puan">${signed(member.dailyDriverScore)}</td></tr>`).join('')}</tbody></table></div><p class="muted tiny crew-source">${crew.exactRoster ? 'Yönetici ve üye listesi ile toplam REP, NightRiderz Üyeler bölümünden; 24 saatlik REP, Crew Activity kayıtlarından alındı.' : 'Son doğrulanan kadro gösteriliyor; NightRiderz okuma oturumu yenilendiğinde canlı değerler otomatik devam eder.'}${crew.profileFailures ? ` ${number(crew.profileFailures)} profil son başarılı değerini korudu.` : ''}</p></section>`;
}
function renderCrew() { return `<section class="card"><div class="card-header"><div><h3>NightRiderz Ekibi #1636</h3><p class="muted">Otomatik yenileme üç saatte bir yapılır. İstediğiniz anda elle yenileyebilirsiniz.</p></div><div class="record-actions"><input id="crew-search" type="search" placeholder="Üye ara" aria-label="Ekip üyelerinde ara"><button class="button primary" id="refresh-crew">↻ Şimdi yenile</button></div></div></section><div id="crew-content">${crewBody(state.guild.crew)}</div>`; }
async function loadCrew(force = false) {
  const guildId = state.guild.id;
  const crew = await guildApi('crew', force ? { method: 'POST', body: '{}' } : undefined);
  if (state.guild?.id !== guildId) return;
  state.guild.crew = crew;
  if ($('#crew-content')) $('#crew-content').innerHTML = crewBody(crew);
}

function render() {
  if (!state.guild) return;
  $('#hero').hidden = state.view !== 'overview';
  $('#guild-name').textContent = state.guild.name;
  $('#view-title').textContent = titles[state.view];
  $('#page-label').textContent = titles[state.view];
  $$('.nav-button').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  const page = ({ overview: renderOverview, rpg: renderRpg, community: renderCommunity, reactionRoles: renderReactionRoles, crew: renderCrew, boosted: renderBoosted, responders: renderResponders, music: renderMusicPage, logs: renderLogs, settings: renderSettings, blacklist: renderBlacklist, protection: renderProtection, tickets: renderTickets, tools: renderTools, faq: renderFaq, access: renderAuthorization })[state.view]();
  $('#view-content').innerHTML = page.replaceAll('/sağlık-asistanı', '/healthcare');
  applyOverviewHeight();
  if (['blacklist', 'tickets', 'tools', 'faq', 'reactionRoles', 'access', 'settings'].includes(state.view)) void loadFeatureRecords().catch(error => notice(error.message, true));
  if (state.view === 'overview') void loadLogs(false, true).catch(error => notice(error.message, true));
  if (state.view === 'logs') void loadLogs().catch(error => notice(error.message, true));
  if ($('#leave-preview')) updateLeavePreview();
  if (state.view === 'crew') void loadCrew().catch(error => notice(error.message, true));
  if (state.view === 'boosted') updateBoostedProgress();
  if (state.view === 'rpg') void loadRpg();
  if (state.view === 'reactionRoles') updateReactionRolePreview();
}
async function loadGuild(guildId) {
  const version = ++guildLoadVersion;
  state.guild = null; state.panelAccess = null; state.reactionRoleRecords = [];
  $('#view-content').innerHTML = '<div class="loading">Sunucu bilgileri yükleniyor…</div>';
  const guild = await api(`/api/guilds/${guildId}`);
  if (version !== guildLoadVersion) return;
  state.guild = guild; state.dirty = false; applyAppearance(guild.settings); render();
}
function changeView(view) {
  if (state.dirty && !confirm('Kaydedilmemiş değişiklikleriniz var. Bu bölümden ayrılmak istiyor musunuz?')) return;
  state.view = view; state.dirty = false; notice(''); render();
}
async function saveSettings(patch) {
  const guild = state.guild;
  const settings = await guildApi('settings', { method: 'PUT', body: JSON.stringify(patch) });
  if (state.guild !== guild) return;
  guild.settings = settings;
  state.dirty = false;
  notice('Ayarlar kaydedildi. Yeni olaylarda hemen uygulanacak.');
}
function updateLeavePreview() {
  const template = $('#leave-message')?.value || '';
  $('#leave-preview').textContent = template.replace(/\{(user|username|server|memberCount)\}/g, (_, key) => ({ user: '@ÖrnekÜye', username: 'ÖrnekÜye', server: state.guild.name, memberCount: state.guild.memberCount })[key]);
}
async function loadLogs(append = false, recent = false) {
  const guildId = state.guild.id;
  const params = new URLSearchParams();
  const type = $('#log-type')?.value;
  if (type) params.set('type', type);
  if (append && state.logs.length) params.set('before', state.logs.at(-1).id);
  const logs = await guildApi(`logs?${params}`);
  if (state.guild?.id !== guildId) return;
  if (recent) { if ($('#recent-logs')) $('#recent-logs').innerHTML = logTable(logs.slice(0, 5)); return; }
  state.logs = append ? [...state.logs, ...logs] : logs;
  if ($('#log-table')) $('#log-table').innerHTML = logTable(state.logs);
  if ($('#more-logs')) $('#more-logs').hidden = logs.length < 50;
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.themeChoice) { document.documentElement.dataset.theme = button.dataset.themeChoice; localStorage.setItem('pitstop-theme', button.dataset.themeChoice); updateThemeButtons(); return; }
    if (button.id === 'menu-toggle') { setMenuOpen(!document.body.classList.contains('menu-open')); return; }
    if (button.id === 'menu-backdrop') { setMenuOpen(false); return; }
    if (button.id === 'toggle-code') { const input = $('#login-code'), showing = input.type === 'text'; input.type = showing ? 'password' : 'text'; button.textContent = showing ? 'Göster' : 'Gizle'; button.setAttribute('aria-label', showing ? 'Kodu göster' : 'Kodu gizle'); return; }
    if (button.dataset.view || button.dataset.go) { if (state.guild) { changeView(button.dataset.view || button.dataset.go); setMenuOpen(false); } return; }
    if (button.dataset.moveView) {
      const group = Object.values(navGroups).find(views => views.includes(button.dataset.moveView));
      const ordered = state.navOrder.filter(view => group.includes(view));
      const localIndex = ordered.indexOf(button.dataset.moveView), other = ordered[localIndex + (button.dataset.direction === 'up' ? -1 : 1)];
      const index = state.navOrder.indexOf(button.dataset.moveView), target = state.navOrder.indexOf(other);
      if (index >= 0 && target >= 0) {
        [state.navOrder[index], state.navOrder[target]] = [state.navOrder[target], state.navOrder[index]];
        localStorage.setItem('pitstop-nav-order', JSON.stringify(state.navOrder));
        applyNavOrder(); render(); notice('Sayfa sırası güncellendi.');
      }
      return;
    }
    if (button.id === 'refresh') { if (state.guild && (!state.dirty || confirm('Kaydedilmemiş değişiklikleri silip yenilemek istiyor musunuz?'))) await loadGuild(state.guild.id); }
    if (button.id === 'reset-overview-height') { localStorage.removeItem(overviewHeightKey); notice('Genel bakış kart boyutu sıfırlandı.'); }
    if (button.id === 'reset-appearance') { $('#panel-logo-url').value = ''; $('#panel-banner-url').value = ''; $('#panel-login-background-url').value = ''; state.dirty = true; return; }
    if (button.id === 'logout') { await api('/auth/logout', { method: 'POST', body: '{}' }); location.reload(); }
    if (button.id === 'add-response') { if ($$('.response-row').length >= 50) throw new Error('En fazla 50 otomatik cevap ekleyebilirsiniz.'); $('#responses').insertAdjacentHTML('beforeend', responseRow()); $('#responses-empty').hidden = true; state.dirty = true; $('#responses').lastElementChild.querySelector('input').focus(); }
    if (button.classList.contains('remove-response')) { button.closest('.response-row').remove(); $('#responses-empty').hidden = Boolean($$('.response-row').length); state.dirty = true; }
    if (button.id === 'add-reaction-role') { if ($$('.reaction-role-row').length >= 20) throw new Error('En fazla 20 emoji ve rol eşleştirmesi ekleyebilirsiniz.'); $('#reaction-role-mappings').insertAdjacentHTML('beforeend', reactionRoleRow()); state.dirty = true; updateReactionRolePreview(); }
    if (button.classList.contains('remove-reaction-role')) { button.closest('.reaction-role-row').remove(); state.dirty = true; updateReactionRolePreview(); }
    if (button.id === 'reload-logs') await loadLogs();
    if (button.hasAttribute('data-crew-sort')) { const key = button.dataset.crewSort; state.crewSort = { key, direction: state.crewSort.key === key ? (state.crewSort.direction === 'desc' ? 'asc' : 'desc') : (key === 'name' ? 'asc' : 'desc') }; $('#crew-content').innerHTML = crewBody(state.guild.crew); return; }
    if (button.id === 'refresh-crew') { button.disabled = true; await loadCrew(true); notice('Ekip REP ve profil bilgileri güncellendi.'); }
    if (button.id === 'refresh-boosted-event') { button.disabled = true; state.guild.boostedEvent = await guildApi('boosted-event', { method: 'POST', body: '{}' }); render(); notice(state.guild.boostedEvent.error ? state.guild.boostedEvent.error : 'Boosted Event kontrol edildi ve kanala bildirildi.', Boolean(state.guild.boostedEvent.error)); }
    if (button.id === 'more-logs') await loadLogs(true);
    if (button.id === 'publish-ticket') { await guildApi('tickets', { method: 'POST', body: '{}' }); notice('Destek düğmesi seçilen kanala yayımlandı.'); }
    if (button.dataset.editFaq) {
      const item = state.faqRecords.find(record => record.id === button.dataset.editFaq);
      if (!item) throw new Error('Düzenlenecek SSS kaydı bulunamadı.');
      const form = $('#faq-form'); form.dataset.editId = item.id; state.editingFaqId = item.id;
      $('#faq-form-title').textContent = 'Soru ve cevabı düzenle';
      $('#faq-question').value = item.question || ''; $('#faq-answer').value = item.answer || '';
      $('#faq-preview').innerHTML = `<strong>${escape(item.question || 'Soru')}</strong><p>${escape(item.answer || 'Cevap')}</p>`;
      $('[name="faq-action"][value="draft"]', form).hidden = true;
      const primary = $('[name="faq-action"][value="publish"]', form); primary.textContent = 'Değişiklikleri kaydet';
      $('#cancel-faq-edit').hidden = false; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#faq-question').focus();
      return;
    }
    if (button.id === 'cancel-faq-edit') { state.editingFaqId = null; state.dirty = false; render(); return; }
    if (button.dataset.removeRecord) {
      const action = button.dataset.ticketAction === 'delete' ? 'Bu Discord kanalı kalıcı olarak silinecek.' : button.dataset.ticketAction === 'close' ? 'Bu destek bileti kapatılacak.' : 'Bu kayıt kaldırılacak.';
      if (!confirm(`${action}\n\nİşleme devam etmek istiyor musunuz?`)) return;
      const deleteDiscordMessage = button.dataset.resource === 'faqs' && button.dataset.hasDiscordMessage ? confirm('Discord kanalındaki yayımlanmış mesaj da silinsin mi?') : false;
      await guildApi(button.dataset.resource, { method: 'DELETE', body: JSON.stringify(button.dataset.resource === 'blacklist' ? { userId: button.dataset.removeRecord } : { id: button.dataset.removeRecord, action: button.dataset.ticketAction, deleteDiscordMessage }) });
      await loadFeatureRecords();
      notice(button.dataset.ticketAction === 'delete' ? 'Destek kanalı silindi.' : button.dataset.ticketAction === 'close' ? 'Destek bileti kapatıldı.' : 'Kayıt güncellendi.');
    }
    if (button.dataset.control) { button.disabled = true; state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: button.dataset.control }) }); render(); notice('Oynatıcı güncellendi.'); }
    if (button.id === 'revoke-sessions') { if (!confirm('Tüm aktif panel oturumları kapatılsın mı? Bu oturum da kapanacaktır.')) return; await guildApi('panel-access', { method: 'DELETE', body: '{}' }); location.reload(); }
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
document.addEventListener('pointerup', event => saveOverviewHeight(event.composedPath().find(node => node?.matches?.('[data-dashboard-size]'))));
document.addEventListener('input', event => {
  if (event.target.closest('form') && event.target.type !== 'search' && !event.target.closest('#play-form,#volume-form,#code-login-form')) state.dirty = true;
  if (event.target.id === 'leave-message') updateLeavePreview();
  if (event.target.id === 'volume') $('#volume-value').textContent = `${event.target.value}%`;
  if (event.target.id === 'faq-question' || event.target.id === 'faq-answer') { const preview = $('#faq-preview'); if (preview) preview.innerHTML = `<strong>${escape($('#faq-question').value || 'Soru')}</strong><p>${escape($('#faq-answer').value || 'Cevap')}</p>`; }
  if (['records-search', 'log-search'].includes(event.target.id)) { const query = event.target.value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim(); const container = event.target.id === 'log-search' ? $('#log-table') : $('#faqs-records'); $$('tbody tr', container).forEach(row => { row.hidden = Boolean(query && !row.textContent.normalize('NFKC').toLocaleLowerCase('tr-TR').includes(query)); }); }
  if (event.target.id === 'response-search') { const query = event.target.value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim(); $$('.response-row').forEach(row => { row.hidden = Boolean(query && !row.textContent.normalize('NFKC').toLocaleLowerCase('tr-TR').includes(query) && !$$('input,textarea', row).some(field => field.value.normalize('NFKC').toLocaleLowerCase('tr-TR').includes(query))); }); }
  if (event.target.id === 'crew-search') { const query = event.target.value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim(); $$('#crew-content tbody tr').forEach(row => { row.hidden = Boolean(query && !row.textContent.normalize('NFKC').toLocaleLowerCase('tr-TR').includes(query)); }); }
  if (event.target.closest('#reaction-role-form')) updateReactionRolePreview();
  if (event.target.classList.contains('record-filter')) { const query = event.target.value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim(); $$('tbody tr', event.target.closest('.card')).forEach(row => { row.hidden = Boolean(query && !row.textContent.normalize('NFKC').toLocaleLowerCase('tr-TR').includes(query)); }); }
});
document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'guild-select') { const old = state.guild?.id; if (state.dirty && !confirm('Kaydedilmemiş değişikliklerden vazgeçmek istiyor musunuz?')) { event.target.value = old; return; } await loadGuild(event.target.value); notice(''); }
    if (event.target.id === 'log-type') await loadLogs();
    if (event.target.closest('#reaction-role-form')) updateReactionRolePreview();
  } catch (error) { notice(error.message, true); }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, button = $('button[type="submit"],button:not([type])', form);
  const buttonContent = button?.innerHTML;
  const guildSelect = $('#guild-select');
  if (guildSelect) guildSelect.disabled = true;
  if (button) button.disabled = true;
  notice('');
  try {
    if (form.id === 'code-login-form') { const code = $('#login-code').value.trim(); $('#login-error').textContent = ''; button.textContent = 'Kod doğrulanıyor…'; await api('/auth/code', { method: 'POST', body: JSON.stringify({ code }) }); location.reload(); return; }
    if (form.id === 'community-form') await saveSettings({ autoRoleEnabled: $('#auto-role-enabled').checked, autoRoleIds: selectedRoles('auto-role-ids'), leaveEnabled: $('#leave-enabled').checked, leaveChannelId: $('#leave-channel').value || null, leaveMessage: $('#leave-message').value });
    if (form.id === 'blacklist-settings') await saveSettings({ blacklistOnLeave: $('#blacklist-on-leave').checked });
    if (form.id === 'blacklist-add') { await guildApi('blacklist', { method: 'POST', body: JSON.stringify({ userId: $('#blacklist-user').value.trim(), reason: $('#blacklist-reason').value.trim() }) }); form.reset(); state.dirty = false; await loadFeatureRecords(); notice('Kullanıcı kara listeye eklendi.'); }
    if (form.id === 'protection-form') await saveSettings({ antiSpamEnabled: $('#anti-spam').checked, antiPhishingEnabled: $('#anti-phishing').checked, spamTimeoutMinutes: Number($('#spam-minutes').value), phishingDomains: $('#phishing-domains').value.split(/\s+/).filter(Boolean) });
    if (form.id === 'tickets-form') await saveSettings({ ticketEnabled: $('#ticket-enabled').checked, ticketChannelId: $('#ticket-channel').value || null, ticketCategoryId: $('#ticket-category').value || null, supportRoleId: $('#support-role').value || null, defenseEnabled: $('#defense-enabled').checked, defenseChannelId: $('#defense-channel').value || null });
    if (form.id === 'health-form') await saveSettings({ healthEnabled: $('#health-enabled').checked, healthHours: Number($('#health-hours').value) });
    if (form.id === 'access-form') await saveSettings({ musicRestricted: $('#music-restricted').checked, musicControllerRoleIds: selectedRoles('controller-roles'), musicControllerUserIds: $('#controller-users').value.split(/\s+/).filter(Boolean) });
    if (form.id === 'panel-access-form') { await saveSettings({ panelAccessRoleIds: selectedRoles('panel-access-roles'), panelSessionHours: Number($('#panel-session-hours').value), panelCodeMinutes: Number($('#panel-code-minutes').value) }); state.panelAccess = await guildApi('panel-access'); render(); }
    if (form.id === 'install-form') { await guildApi('access', { method: 'PUT', body: JSON.stringify({ guildIds: $('#allowed-guilds').value.split(/\s+/).filter(Boolean) }) }); state.dirty = false; notice('İzin verilen sunucular kaydedildi.'); }
    if (form.id === 'responders-form') await saveSettings({ responderEnabled: $('#responder-enabled').checked, responses: $$('.response-row').map(row => ({ trigger: $('[name="trigger"]', row).value.trim().replace(/^!+/u, ''), reply: $('[name="reply"]', row).value.trim() })) });
    if (form.id === 'reaction-role-form') {
      const mappings = $$('.reaction-role-row').map(row => ({ emoji: $('[name="reaction-emoji"]', row).value, roleId: $('[name="reaction-role"]', row).value }));
      await guildApi('reaction-roles', { method: 'POST', body: JSON.stringify({ channelId: $('#reaction-role-channel').value, content: $('#reaction-role-content').value.trim(), mappings }) });
      state.dirty = false; state.guild.reactionRoleCount = Number(state.guild.reactionRoleCount || 0) + 1; await loadReactionRoleRecords(); render(); notice('Emoji ile rol mesajı Discord kanalına yayımlandı.');
    }
    if (form.id === 'music-settings-form') await saveSettings({ musicEnabled: $('#music-enabled').checked, musicVolume: Number($('#default-volume').value), djRoleId: $('#dj-role').value || null });
    if (form.id === 'rpg-settings-form') await saveSettings({ rpgAnnouncementChannelId: $('#rpg-announcement-channel').value || null });
    if (form.id === 'settings-form') await saveSettings({ logChannelId: $('#log-channel').value || null });
    if (form.id === 'appearance-form') {
      await saveSettings({ panelLogoUrl: $('#panel-logo-url').value.trim() || null, panelBannerUrl: $('#panel-banner-url').value.trim() || null, panelLoginBackgroundUrl: $('#panel-login-background-url').value.trim() || null });
      if (state.guild.settings.panelLogoUrl) localStorage.setItem('pitstop-logo-url', state.guild.settings.panelLogoUrl); else localStorage.removeItem('pitstop-logo-url');
      applyAppearance(state.guild.settings); notice('Panel görselleri ve giriş arka planı güncellendi.');
    }
    if (form.id === 'boosted-form') await saveSettings({ boostedEventEnabled: $('#boosted-event-enabled').checked, boostedEventChannelId: $('#boosted-event-channel').value || null });
    if (form.id === 'faq-settings-form') await saveSettings({ faqEnabled: $('#faq-enabled').checked, faqChannelId: $('#faq-channel').value || null });
    if (form.id === 'faq-form') {
      const draft = event.submitter?.value === 'draft', editId = form.dataset.editId;
      await guildApi('faqs', { method: editId ? 'PUT' : 'POST', body: JSON.stringify({ id: editId, question: $('#faq-question').value.trim(), answer: $('#faq-answer').value.trim(), draft }) });
      form.reset(); delete form.dataset.editId; state.editingFaqId = null; state.dirty = false; await loadFeatureRecords();
      render(); notice(editId ? 'SSS kaydı ve bağlı Discord mesajı güncellendi.' : draft ? 'SSS taslağı kaydedildi.' : 'Soru ve cevap Discord kanalına yayımlandı.');
    }
    if (form.id === 'play-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'play', query: $('#query').value.trim() }) }); render(); notice('Parça çalma sırasına eklendi.'); }
    if (form.id === 'volume-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'volume', volume: Number($('#volume').value) }) }); notice('Ses seviyesi güncellendi.'); }
  } catch (error) { if (form.id === 'code-login-form') $('#login-error').textContent = error.message; notice(error.message, true); }
  finally { if (button) { button.disabled = false; if (form.id === 'code-login-form' && buttonContent) button.innerHTML = buttonContent; } if (guildSelect) guildSelect.disabled = false; }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

Object.assign(logTypeNames, { 'panel.login': 'Panel girişi', 'settings.detail': 'Ayar ayrıntısı', 'discord.audit': 'Discord yetkili işlemi', 'blacklist.updated': 'Kara liste', 'protection.phishing': 'Oltalama engellendi', 'protection.spam': 'Spam engellendi', 'reminder.created': 'Hatırlatıcı oluşturuldu', 'reminder.sent': 'Hatırlatıcı gönderildi', 'reminder.failed': 'Hatırlatıcı hatası', 'health.sent': 'Mola hatırlatması', 'ticket.opened': 'Destek açıldı', 'ticket.closed': 'Destek kapandı', 'ticket.deleted': 'Destek kanalı silindi', 'defense.opened': 'Savunma odası açıldı', 'defense.reply': 'Üye savunması', 'defense.staff_reply': 'Yetkili yanıtı', 'conversation.message': 'Özel oda mesajı', 'moderation.warning': 'Üye uyarıldı', 'access.updated': 'Kurulum yetkisi', 'faq.published': 'SSS yayımlandı', 'faq.updated': 'SSS düzenlendi', 'faq.deleted': 'SSS kaydı kaldırıldı', 'boosted.announced': 'Boosted Event duyurusu', 'reaction_role.published': 'Emoji rolü yayımlandı', 'reaction_role.deleted': 'Emoji rolü kaldırıldı', 'reaction_role.assigned': 'Emoji rolü verildi', 'reaction_role.removed': 'Emoji rolü geri alındı', 'reaction_role.error': 'Emoji rolü hatası' });
function renderBlacklist(settingsOnly = false) {
  const settings = `<form id="blacklist-settings" class="card form-stack">${toggle('blacklist-on-leave', 'Ayrılan üyeyi kara listeye ekle', 'Kayıt tutulur; kişiyi otomatik yasaklamaz. Yeniden katılırsa kayıt korunur.', state.guild.settings.blacklistOnLeave)}<div class="form-actions"><button class="button primary">Ayarı kaydet</button></div></form>`;
  if (settingsOnly) return settings;
  return `<div class="grid-2 balanced-grid">${settings}<form id="blacklist-add" class="card form-stack"><div><h3>Elle kayıt ekle</h3><p class="muted tiny">Discord kullanıcı kimliği ve kayıt sebebiyle manuel bir kara liste kaydı oluşturun.</p></div><label>Kullanıcı kimliği<input id="blacklist-user" required pattern="[0-9]{17,20}" maxlength="20"></label><label>Sebep<input id="blacklist-reason" required maxlength="1000"></label><div class="form-actions"><button class="button primary">Kara listeye ekle</button></div></form><section class="card wide"><div class="card-header"><h3>Kara liste kayıtları</h3><input class="record-filter" type="search" placeholder="Üye veya sebep ara" aria-label="Kara listede ara"></div><div id="blacklist-records">Yükleniyor…</div></section></div>`;
}
function renderProtection() {
  const s = state.guild.settings, p = state.guild.protection || {};
  return `<form id="protection-form" class="form-stack"><div class="grid-2"><section class="card form-stack">${toggle('anti-spam', 'Aynı mesaj koruması', '3 saniye içinde aynı mesaj 5 kez gönderildiğinde mesajı sil ve zaman aşımı uygula. Mesajları Yönet izni olanlar spam kontrolünden muaftır.', s.antiSpamEnabled)}<label>Spam zaman aşımı süresi (dakika)<input type="number" id="spam-minutes" min="1" max="1440" value="${s.spamTimeoutMinutes}" required></label></section><section class="card form-stack">${toggle('anti-phishing', 'Oltalama koruması', 'URL alan adlarını güncel yerel listeyle karşılaştır; eşleşmede mesajı sil, kullanıcıyı DM ile uyar ve 12 saat zaman aşımı uygula.', s.antiPhishingEnabled)}<p>${number(p.domains)} alan adı · Son güncelleme: ${date(p.updatedAt)}</p>${p.error ? `<p class="hint">${escape(p.error)}</p>` : ''}<p class="muted tiny">Discord-AntiScam listesi 15 dakikada bir yenilenir. Ağ, izin ve Discord hız sınırları nedeniyle milisaniyede silme garantisi yoktur. Yeni veya listelenmemiş saldırılar tespit edilmeyebilir.</p></section></div><section class="card"><label>Ek engellenecek alan adları (her satıra bir tane)<textarea id="phishing-domains" rows="7" placeholder="zararli-ornek.test">${escape(s.phishingDomains.join('\n'))}</textarea></label><p class="muted tiny">Tam alan adı ve alt alan adları eşleşir; benzer yazılan güvenli alan adları eşleşmez. URL veya yol eklemeyin.</p></section><div class="form-actions"><button class="button primary">Koruma ayarlarını kaydet</button></div></form>`;
}
function renderTickets(settingsOnly = false) {
  const s = state.guild.settings;
  const settings = `<form id="tickets-form" class="form-stack"><section class="card"><label>Destek yetkilisi rolü<select id="support-role">${roleOptions(s.supportRoleId).replace('Herkes kullanabilir', 'Destek rolünü seçin')}</select></label></section><div class="grid-2"><section class="card form-stack">${toggle('ticket-enabled', 'Özel destek biletleri', 'Kullanıcı ve destek rolü için özel metin kanalı açar.', s.ticketEnabled)}<label>Destek düğmesinin kanalı<select id="ticket-channel">${channelOptions(s.ticketChannelId)}</select></label><label>Bilet kategorisi<select id="ticket-category"><option value="">Kategori seçilmedi</option>${state.guild.channels.filter(c => c.type === 4).map(c => `<option value="${c.id}" ${s.ticketCategoryId === c.id ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label><button type="button" id="publish-ticket" class="button subtle">Kaydedilen kanala destek düğmesini yayımla</button></section><section class="card form-stack">${toggle('defense-enabled', 'Özel savunma ileti dizileri', '/uyar veya Discord zaman aşımı işleminden sonra özel ileti dizisi oluşturur.', s.defenseEnabled)}<label>Savunma ana kanalı<select id="defense-channel">${channelOptions(s.defenseChannelId, false, true)}</select></label><div class="hint">Zaman aşımı alan üyeler Discord ileti dizisine yazamaz. Botun DM düğmesiyle savunma iletirler; yetkililer /savunma-yanıt ile cevap verir. DM kapalıysa bu yol kullanılamaz. Yönetici ve İleti Dizilerini Yönet izni olan kişiler özel ileti dizilerini görebilir.</div></section></div><div class="form-actions"><button class="button primary">Destek ayarlarını kaydet</button></div></form>`;
  if (settingsOnly) return settings;
  return `${settings}<section class="card"><h3>Destek biletleri</h3><div id="tickets-records">Yükleniyor…</div></section><section class="card"><h3>Savunma kayıtları</h3><div id="cases-records">Yükleniyor…</div></section>`;
}
function renderTools(settingsOnly = false) {
  const s = state.guild.settings;
  const healthSettings = `<form id="health-form" class="card form-stack">${toggle('health-enabled', 'Sağlık asistanı', 'Kullanıcı /healthcare durum:aç ile kişisel olarak katılır.', s.healthEnabled)}<label>Mola aralığı (saat)<input id="health-hours" type="number" min="1" max="12" value="${s.healthHours}" required></label><p class="muted tiny">Ses kanalı takibi açık. Oyun/Rich Presence takibi: ${state.guild.presenceEnabled ? 'açık' : 'Presence Intent bekliyor'}. Ekran etkinliği ölçülmez; Discord etkinliği esas alınır. Yeniden başlatmada kesintisiz oturum süresi sıfırlanır.</p><button class="button primary">Kaydet</button></form>`;
  if (settingsOnly) return healthSettings;
  return `<div class="grid-2"><section class="card"><h3>Gelişmiş hatırlatıcı</h3><p><code>/hatırlat not:2 saat sonra NFS turnuvası var hedef:DM</code></p><p><code>/hatırlatıcılar</code> ile listele veya kimliğiyle iptal et.</p><p class="muted">1 dakika–365 gün. Kayıtlar yeniden başlatmada korunur. Bildirimler yaklaşık 15 saniyelik aralıklarla kontrol edilir; sunucu kapalı kaldıysa açıldığında gönderilir.</p></section>${healthSettings}<section class="card wide"><h3>Hatırlatıcı kayıtları</h3><p class="muted tiny">Diğer kullanıcıların özel DM notları bu listede gizlenir.</p><div id="reminders-records">Yükleniyor…</div></section></div>`;
}
function renderAccess() {
  const s = state.guild.settings;
  return `<form id="access-form" class="card form-stack">${toggle('music-restricted', 'Müzik ve bağlantı kontrolünü yetkililere sınırla', 'Sunucuyu Yönet yetkisi, DJ rolü veya aşağıdaki yetkiler gerekir. Botla aynı ses kanalında bulunma şartı devam eder.', s.musicRestricted)}<label>Yetkili roller</label>${roleChecks('controller-roles', s.musicControllerRoleIds)}<label>Ek yetkili kullanıcı kimlikleri (her satıra bir tane)<textarea id="controller-users" rows="3">${escape(s.musicControllerUserIds.join('\n'))}</textarea></label><div class="hint">Discord’un sağ tık → Taşı işlemi Discord’daki Üyeleri Taşı yetkisine bağlıdır. Bot, bu yerel Discord iznini başka yöneticilerden kaldıramaz. Müzik komutları ve panel kontrolleri burada sınırlandırılır.</div><button class="button primary">Yetkileri kaydet</button></form>${state.me.installationOwner ? `<form id="install-form" class="card form-stack"><h3>İzin verilen kurulum sunucuları</h3><label>Sunucu kimlikleri<textarea id="allowed-guilds" rows="4" required></textarea></label><p class="muted tiny">Bu listeyi yalnızca bot sahibi düzenler. Bot diğer sunuculara eklendiğinde ayrılır. Discord Developer Portal’daki Public Bot kapalıysa kurulumu uygulama sahibi/ekibi yapabilir.</p><button class="button primary">Kurulum izinlerini kaydet</button></form>` : '<section class="card">Başka sunucuya kurulum izinlerini yalnızca bot sahibi yönetebilir.</section>'}`;
}
function renderAuthorization() {
  const s = state.guild.settings, panel = state.panelAccess || { activeCount: 0, sessions: [] };
  return `<div class="grid-2"><form id="panel-access-form" class="card form-stack"><div class="card-header"><div><h3>Panel erişimi</h3><p class="muted tiny">Rol kimlikleri üzerinden kontrol edilir. Sunucuyu Yönet yetkisi olanlar da erişebilir.</p></div>${badge(panel.activeCount > 0, `${panel.activeCount} aktif oturum`, 'Aktif oturum yok')}</div><label>Panele erişebilecek roller</label>${roleChecks('panel-access-roles', s.panelAccessRoleIds || [])}<div class="grid-2"><label>Oturum süresi (saat)<input id="panel-session-hours" type="number" min="1" max="8" value="${s.panelSessionHours || 8}" required></label><label>Tek kullanımlık kod süresi (dakika)<input id="panel-code-minutes" type="number" min="1" max="5" value="${s.panelCodeMinutes || 2}" required></label></div><div class="form-actions"><button class="button primary">Panel erişimini kaydet</button><button id="revoke-sessions" type="button" class="button danger">Tüm aktif oturumları kapat</button></div></form><form id="access-form" class="card form-stack">${toggle('music-restricted', 'Müzik kontrolünü yetkililere sınırla', 'Panel giriş erişiminden bağımsızdır.', s.musicRestricted)}<label>Müzik yetkilisi rolleri</label>${roleChecks('controller-roles', s.musicControllerRoleIds)}<label>Ek yetkili kullanıcı kimlikleri<textarea id="controller-users" rows="3">${escape(s.musicControllerUserIds.join('\n'))}</textarea></label><button class="button primary">Müzik yetkilerini kaydet</button></form><section class="card wide"><div class="card-header"><h3>Aktif oturumlar</h3><span class="badge">${panel.activeCount} oturum</span></div>${panel.sessions?.length ? `<div class="table-wrap"><table><thead><tr><th>KULLANICI</th><th>YÖNTEM</th><th>AÇILIŞ</th><th>SONA ERME</th></tr></thead><tbody>${panel.sessions.map(item => `<tr><td data-label="KULLANICI">${escape(item.user?.name || item.user?.username || item.user?.id)}</td><td data-label="YÖNTEM">${item.authType === 'code' ? 'Tek kullanımlık kod' : 'Discord OAuth'}</td><td data-label="AÇILIŞ">${date(item.createdAt)}</td><td data-label="SONA ERME">${date(item.expires)}</td></tr>`).join('')}</tbody></table></div>` : empty('Aktif panel oturumu yok.')}</section></div>`;
}
function renderMusicPage() {
  const s = state.guild.settings;
  return `${renderMusic()}<form id="music-settings-form" class="card form-stack music-module-settings"><div class="card-header"><div><h3>Müzik modülü ayarları</h3><p class="muted tiny">Bu ayarlar yalnızca Müzik istasyonu sayfasından yönetilir.</p></div>${badge(state.guild.music.available,'Bağlantı hazır','Bağlantı bekleniyor')}</div>${toggle('music-enabled', 'Müzik modülü', 'Müzik komutlarını ve panel oynatıcısını etkinleştir.', s.musicEnabled)}<div class="grid-2"><label>DJ rolü<select id="dj-role">${roleOptions(s.djRoleId)}</select></label><label>Varsayılan ses düzeyi<input id="default-volume" type="number" min="1" max="100" value="${s.musicVolume}" required></label></div><button class="button primary">Müzik ayarlarını kaydet</button></form>`;
}
function featureActions(resource, item) {
  if (resource === 'tickets') {
    const actions = [];
    if (item.status === 'open') actions.push(`<button class="button subtle" data-resource="tickets" data-remove-record="${escape(item.id)}" data-ticket-action="close">Bileti Kapat</button>`);
    if (item.status !== 'deleted' && state.guild.viewerPermissions?.manageChannels && state.guild.bot.permissions.manageChannels) actions.push(`<button class="button danger" data-resource="tickets" data-remove-record="${escape(item.id)}" data-ticket-action="delete">Kanalı Sil</button>`);
    return actions.length ? `<div class="record-actions">${actions.join('')}</div>` : escape(item.status);
  }
  if (resource === 'blacklist') return `<button class="button danger" data-resource="${resource}" data-remove-record="${escape(item.id)}">Kaldır</button>`;
  if (resource === 'faqs') return `<div class="record-actions"><span class="badge ${item.status === 'draft' ? 'off' : 'on'}">${item.status === 'draft' ? 'Taslak' : 'Yayında'}</span><button class="button subtle" data-edit-faq="${escape(item.id)}">Düzenle</button><button class="button danger" data-resource="faqs" data-remove-record="${escape(item.id)}" ${item.messageId ? 'data-has-discord-message="true"' : ''}>Kaydı kaldır</button></div>`;
  if (item.status === 'open' || (resource === 'reminders' && item.userId === state.me.user.id && item.status === 'pending')) return `<button class="button danger" data-resource="${resource}" data-remove-record="${escape(item.id)}">Kapat / iptal et</button>`;
  return escape(item.status);
}
function reactionRoleRecordsTable(items) {
  return items.length ? `<div class="table-wrap"><table><thead><tr><th>KANAL VE MESAJ</th><th>TEPKİ → ROL</th><th>YAYIMLAYAN</th><th>İŞLEM</th></tr></thead><tbody>${items.map(item => `<tr><td data-label="KANAL VE MESAJ"><strong>#${escape(item.channelName || item.channelId)}</strong><p>${escape(item.content)}</p><a href="https://discord.com/channels/${state.guild.id}/${escape(item.channelId)}/${escape(item.id)}" target="_blank" rel="noopener noreferrer">Discord mesajını aç ↗</a></td><td data-label="TEPKİ → ROL"><div class="reaction-record-list">${(item.mappings || []).map(mapping => `<span><b>${escape(mapping.label)}</b> → ${escape(mapping.roleName || mapping.roleId)}</span>`).join('')}</div></td><td data-label="YAYIMLAYAN">${escape(item.createdByName || item.createdBy)}<small class="muted">${date(item.createdAt)}</small></td><td data-label="İŞLEM"><button class="button danger" data-resource="reaction-roles" data-remove-record="${escape(item.id)}">Yayını kaldır</button></td></tr>`).join('')}</tbody></table></div>` : empty('Henüz yayımlanmış bir emoji rolü mesajı yok.');
}
async function loadReactionRoleRecords() {
  const guildId = state.guild.id;
  const items = await guildApi('reaction-roles');
  if (state.guild?.id !== guildId) return;
  state.reactionRoleRecords = items;
  state.guild.reactionRoleCount = items.length;
  const node = $('#reaction-roles-records');
  if (node) node.innerHTML = reactionRoleRecordsTable(items);
  if ($('#reaction-role-count')) $('#reaction-role-count').textContent = `${items.length} yayın`;
}
async function loadFeatureRecords() {
  const guildId = state.guild.id, view = state.view;
  if (view === 'reactionRoles') { await loadReactionRoleRecords(); return; }
  if (view === 'access') { if (state.panelAccess) return; state.panelAccess = await guildApi('panel-access'); if (state.guild?.id === guildId && state.view === view) { const scroll = window.scrollY; render(); window.scrollTo(0, scroll); } return; }
  if (view === 'settings') { if (state.me.installationOwner) { const access = await guildApi('access'); if (state.guild?.id === guildId && $('#allowed-guilds')) $('#allowed-guilds').value = access.guildIds.join('\n'); } return; }
  for (const resource of view === 'blacklist' ? ['blacklist'] : view === 'tickets' ? ['tickets', 'cases'] : view === 'faq' ? ['faqs'] : ['reminders']) {
    const items = await guildApi(resource);
    if (state.guild?.id !== guildId || state.view !== view) return;
    const node = $(`#${resource}-records`);
    if (!node) continue;
    if (resource === 'faqs') state.faqRecords = items;
    node.innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>${resource === 'faqs' ? 'SORU' : 'ÜYE'}</th><th>${resource === 'faqs' ? 'CEVAP' : 'AYRINTI'}</th><th>TARİH / SAAT</th><th>İŞLEM</th></tr></thead><tbody>${items.map(item => `<tr><td data-label="${resource === 'faqs' ? 'SORU' : 'ÜYE'}">${escape(item.question || item.name || item.userId || item.id)}<small class="muted">${escape(item.createdByName || item.userId || item.id)}</small></td><td data-label="${resource === 'faqs' ? 'CEVAP' : 'AYRINTI'}">${escape(item.answer || item.reason || item.text || item.status)}${item.dueAt ? `<p>Hatırlatma: ${date(item.dueAt)}</p>` : ''}${['tickets', 'cases'].includes(resource) && item.status !== 'deleted' ? `<a href="https://discord.com/channels/${guildId}/${item.id}" target="_blank" rel="noopener noreferrer">Discord’da aç</a>` : ''}${resource === 'faqs' && item.channelId && item.messageId ? `<p><a href="https://discord.com/channels/${guildId}/${item.channelId}/${item.messageId}" target="_blank" rel="noopener noreferrer">Discord mesajını aç</a></p>` : ''}</td><td data-label="TARİH / SAAT">${date(item.createdAt)}</td><td data-label="İŞLEM">${featureActions(resource, item)}</td></tr>`).join('')}</tbody></table></div>` : empty('Henüz kayıt yok.');
  }
}
function updateLoginClock() {
  const now = new Date();
  if ($('#login-time')) $('#login-time').textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if ($('#login-datetime')) $('#login-datetime').textContent = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }).toLocaleUpperCase('tr-TR');
}
async function loadWeather() {
  const weather = $('#weather');
  try {
    const data = await api('/api/weather');
    weather.textContent = `${number(data.temperature)}°C · ${data.description} · Hissedilen ${number(data.apparent)}°C`;
  } catch { weather.textContent = 'İstanbul hava durumu şu anda kullanılamıyor'; }
}
let loginClockTimer;

async function boot() {
  const theme = localStorage.getItem('pitstop-theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; updateThemeButtons(); applyAppearance();
  state.navOrder = savedNavOrder(); applyNavOrder();
  if (staticHosting) {
    if (livePanelUrl) { location.replace(new URL('/', livePanelUrl).href); return; }
    $('#login-error').textContent = 'Canlı panel bağlantısı henüz ayarlanmadı.';
    return;
  }
  updateLoginClock(); loginClockTimer = setInterval(updateLoginClock, 1000); void loadWeather();
  try {
    const status = await api('/api/status');
    applyAppearance(status.appearance);
    $('#version-label').textContent = `Pit-Stop v${status.version} · ${status.build}`;
    $('#connection-dot').classList.toggle('online', status.ready);
    $('#connection-label').textContent = status.ready ? 'Discord bağlantısı aktif' : 'Discord bağlantısı bekleniyor';
    try { state.me = await api('/api/me'); } catch (error) { if (error.status !== 401) throw error; return; }
    document.body.classList.remove('logged-out');
    state.csrf = state.me.csrf;
    $('#user-label').textContent = greetingText();
    $('#logout').hidden = false;
    state.guilds = await api('/api/guilds');
    if (!state.guilds.length) { throw new Error('Yönetebileceğiniz bir sunucu bulunamadı. Bot kurulumunu ve Sunucuyu Yönet izninizi kontrol edin.'); }
    clearInterval(loginClockTimer); $('#login-panel').hidden = true; $('#workspace').hidden = false;
    await loadGuild(state.guilds[0].id);
  } catch (error) { notice(error.message, true); }
}
await boot();
setInterval(async () => {
  if (!state.guild || document.hidden || state.dirty) return;
  try {
    if (state.view === 'logs') await loadLogs();
    if (state.view === 'overview') await loadLogs(false, true);
    if (state.view === 'rpg' && !$('#rpg-content')?.contains(document.activeElement)) await loadRpg();
    if (state.view === 'music' && !$('#query')?.value && !$('#view-content').contains(document.activeElement)) { const music = await guildApi('music'); state.guild.music = music; render(); }
  } catch { /* User-triggered refresh reports connection errors without interrupting editing. */ }
}, 15_000);
setInterval(updateBoostedProgress, 1_000);
