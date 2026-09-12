import { staticHosting, livePanelUrl } from './site-config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { csrf: '', guild: null, view: 'overview', logs: [], dirty: false, me: null };
let guildLoadVersion = 0;
const titles = { overview: 'Genel bakış', community: 'Üyeler & roller', responders: 'Otomatik cevaplar', music: 'Müzik istasyonu', logs: 'Olay kayıtları', settings: 'Bot ayarları', blacklist: 'Üye blacklist', protection: 'Spam & phishing koruması', tickets: 'Destek & savunma', tools: 'Hatırlatıcı & sağlık', access: 'Yetkilendirme' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const check = value => value ? 'checked' : '';
const badge = (value, yes = 'Etkin', no = 'Kapalı') => `<span class="badge ${value ? 'on' : 'off'}">${value ? '●' : '○'} ${escape(value ? yes : no)}</span>`;
const number = value => Number(value || 0).toLocaleString('tr-TR');
const duration = ms => `${Math.floor((ms || 0) / 60000)}:${String(Math.floor((ms || 0) / 1000) % 60).padStart(2, '0')}`;
const uptime = seconds => seconds >= 86400 ? `${Math.floor(seconds / 86400)} gün` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} sa` : `${Math.floor(seconds / 60)} dk`;
const date = value => value ? new Date(value).toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : '—';
function greeting() {
  const hour = new Date().getHours(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<section class="card greeting"><h3>${hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}, ${escape(state.me?.user.name)}. Hoş geldiniz!</h3><p class="muted tiny">${escape(zone)} saat dilimine göre · <time id="local-clock">${date(Date.now())}</time></p></section>`;
}
function roleChecks(id, selected = [], assignable = false) { return `<div id="${id}" class="role-checks">${state.guild.roles.filter(r => !assignable || r.assignable || selected.includes(r.id)).map(r => `<label><input type="checkbox" value="${escape(r.id)}" ${check(selected.includes(r.id))}> ${escape(r.name)}${assignable && !r.assignable ? ' (botun rol hiyerarşisini kontrol edin)' : ''}</label>`).join('') || '<p class="muted">Botun atayabileceği rol yok. Discord’da Pit-Stop bot rolünü atanacak rollerin üstüne taşıyın.</p>'}</div>`; }
const selectedRoles = id => $$(`#${id} input:checked`).map(input => input.value);

function notice(message, error = false) { const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.hidden = !message; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, ...options.headers } });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'İşlem tamamlanamadı.'); error.status = response.status; throw error; }
  return body;
}
const guildApi = (resource = '', options) => api(`/api/guilds/${state.guild.id}${resource ? `/${resource}` : ''}`, options);
function channelOptions(selected, voice = false, textOnly = false) {
  return `<option value="">Kanal seçin</option>` + state.guild.channels.filter(channel => voice ? channel.type === 2 : textOnly ? channel.type === 0 : [0, 5].includes(channel.type)).map(channel => `<option value="${escape(channel.id)}" ${selected === channel.id ? 'selected' : ''}>${voice ? '♫' : '#'} ${escape(channel.name)}</option>`).join('');
}
function roleOptions(selected, assignable = false) {
  return `<option value="">${assignable ? 'Rol seçin' : 'Herkes kullanabilir'}</option>` + state.guild.roles.filter(role => !assignable || role.assignable).map(role => `<option value="${escape(role.id)}" ${selected === role.id ? 'selected' : ''}>${escape(role.name)}</option>`).join('');
}
const toggle = (id, title, description, enabled) => `<div class="switch-row"><div><label for="${id}">${title}</label><p>${description}</p></div><input type="checkbox" id="${id}" ${check(enabled)}></div>`;
const empty = message => `<div class="empty"><span class="empty-symbol" aria-hidden="true">◇</span>${escape(message)}</div>`;

function renderOverview() {
  const { settings: s, bot, memberCount, music } = state.guild;
  const modules = [
    ['↗', 'Otomatik roller', 'Yeni üyelere seçtiğin tüm rolleri ver.', s.autoRoleEnabled],
    ['↙', 'Ayrılma mesajları', 'Ayrılan üyeleri seçtiğin kanala bildir.', s.leaveEnabled],
    ['⌘', 'Otomatik cevaplar', `${s.responses.length} özel ! komutu hazır.`, s.responderEnabled],
    ['♫', 'Müzik istasyonu', 'YouTube Music ve Spotify bağlantıları.', s.musicEnabled],
    ['◇', 'Üye blacklist', 'Sunucudan ayrılan üyelerin kaydını tut.', s.blacklistOnLeave],
    ['⌁', 'Spam koruması', '3 saniyede 5 aynı mesajı engelle.', s.antiSpamEnabled],
    ['◈', 'Phishing koruması', 'Güncel alan adı listesiyle zararlı bağlantıları engelle.', s.antiPhishingEnabled],
    ['□', 'Destek biletleri', 'Üye ve yetkililer için özel destek kanalları.', s.ticketEnabled],
    ['♧', 'Savunma odaları', 'Moderasyon işlemleri için kayıtlı özel görüşmeler.', s.defenseEnabled],
    ['◷', 'Hatırlatıcılar', '/hatırlat ile kalıcı kişisel notlar.', true],
    ['☀', 'Sağlık asistanı', 'Katılmayı seçen üyelere mola hatırlatmaları.', s.healthEnabled],
  ];
  const active = modules.filter(([, , , enabled]) => enabled).length;
  return `<div class="stats">
    <div class="card stat"><div class="stat-label">Toplam üye <span class="stat-icon">♧</span></div><div class="stat-value">${number(memberCount)}</div><div class="stat-foot">Sunucunun güncel üye sayısı</div></div>
    <div class="card stat"><div class="stat-label">Bot gecikmesi <span class="stat-icon">ϟ</span></div><div class="stat-value">${number(bot.ping)} <small class="tiny muted">ms</small></div><div class="stat-foot">${bot.ready ? 'Discord bağlantısı aktif' : 'Discord’a bağlanıyor'}</div></div>
    <div class="card stat"><div class="stat-label">Etkin modüller <span class="stat-icon">⌘</span></div><div class="stat-value">${active}<small class="tiny muted"> / ${modules.length}</small></div><div class="stat-foot">Sunucuna özel otomasyonlar</div></div>
    <div class="card stat"><div class="stat-label">Çalışma süresi <span class="stat-icon">◷</span></div><div class="stat-value">${uptime(bot.uptime)}</div><div class="stat-foot">Son başlatılmadan bu yana</div></div>
  </div><div class="grid-2"><section class="card"><div class="card-header"><h3>Sunucunun pit ekibi</h3><span class="badge">${modules.length} modül</span></div>
  ${modules.map(([icon, name, description, enabled]) => `<div class="module-row"><div class="module-name"><span class="module-icon" aria-hidden="true">${icon}</span><div><strong>${name}</strong><p>${description}</p></div></div>${badge(enabled)}</div>`).join('')}
  <div class="quick-actions"><button class="button subtle" data-go="community">Üye ayarlarını düzenle ↗</button></div></section>
  <section class="card"><div class="card-header"><h3>Şimdi garajda çalıyor</h3>${badge(music.connected, 'Bağlı', 'Beklemede')}</div><div class="record" aria-hidden="true"><span>•</span></div><div class="now-playing"><h3>${escape(music.current?.title || 'Henüz bir parça çalmıyor')}</h3><p>${escape(music.current?.author || 'Ses kanalına katıl, müzik istasyonundan bir parça seç.')}</p></div><div class="quick-actions"><button class="button primary" data-go="music">Müzik istasyonunu aç ♫</button></div></section>
  <section class="card wide"><div class="card-header"><h3>Son hareketler</h3><button class="button subtle" data-go="logs">Tüm kayıtlar ↗</button></div><div id="recent-logs" class="muted">Kayıtlar yükleniyor…</div></section></div>`;
}

function renderCommunity() {
  const s = state.guild.settings;
  return `<form id="community-form"><div class="grid-2"><section class="card form-stack">${toggle('auto-role-enabled', 'Otomatik roller', 'Sunucuya katılan üyelere seçtiğin tüm rolleri ver.', s.autoRoleEnabled)}<div class="field"><label>Verilecek roller</label>${roleChecks('auto-role-ids', s.autoRoleIds || [], true)}<small>Birden fazla rol işaretleyebilirsin.</small></div><div class="hint">Botun rolünü verilecek rollerin üzerinde tutun ve Rolleri Yönet iznini açın.</div></section>
  <section class="card form-stack">${toggle('leave-enabled', 'Ayrılma mesajları', 'Sunucudan ayrılan üyeler için mesaj gönder.', s.leaveEnabled)}<div class="field"><label for="leave-channel">Bildirim kanalı</label><select id="leave-channel">${channelOptions(s.leaveChannelId)}</select></div><div class="field"><label for="leave-message">Ayrılma mesajı</label><textarea id="leave-message" maxlength="1000" rows="4">${escape(s.leaveMessage)}</textarea><small>Değişkenler: {user}, {username}, {server}, {memberCount}</small></div><div class="hint"><strong>Önizleme</strong><p id="leave-preview"></p></div></section></div><div class="form-actions"><span class="muted tiny">Değişiklikler kaydettikten sonra uygulanır.</span><button class="button primary" type="submit">Değişiklikleri kaydet</button></div></form>`;
}
function responseRow(response = { trigger: '', reply: '' }) {
  return `<div class="response-row"><div class="field trigger-field"><label>Komut (! olmadan)<input name="trigger" value="${escape(response.trigger)}" placeholder="kurallar" maxlength="32" required></label></div><div class="field reply-field"><label>Botun cevabı<textarea name="reply" placeholder="Sunucu kurallarını #kurallar kanalında bulabilirsin." maxlength="1800" required>${escape(response.reply)}</textarea></label></div><button type="button" class="button danger remove-response" aria-label="Bu otomatik cevabı kaldır">×</button></div>`;
}
function renderResponders() {
  const s = state.guild.settings;
  return `<form id="responders-form"><section class="card">${toggle('responder-enabled', 'Otomatik cevaplar', 'Üyeler !komut yazdığında tanımladığın mesajla cevap ver.', s.responderEnabled)}<div class="response-toolbar"><h3>Özel cevapların</h3><button type="button" id="add-response" class="button subtle">+ Cevap ekle</button></div><div class="responses" id="responses">${s.responses.map(responseRow).join('')}</div><p class="muted tiny" id="responses-empty" ${s.responses.length ? 'hidden' : ''}>Henüz özel bir cevap yok. İlk komutunu ekleyerek başla.</p><div class="hint"><span class="inline-code">!kurallar</span> gibi komutlar tam eşleşmeyle çalışır. Büyük/küçük harf fark etmez. Diğer bot komutlarını <span class="inline-code">/</span> ile kullanabilirsin.</div></section><div class="form-actions"><button class="button primary" type="submit">Cevapları kaydet</button></div></form>`;
}
function renderMusic() {
  const s = state.guild.settings, m = state.guild.music;
  return `<div class="music-layout"><section class="card player"><div class="card-header"><h3>Oynatıcı</h3>${badge(m.available, 'Müzik bağlantısı hazır', 'Bağlantı bekleniyor')}</div><div class="record" aria-hidden="true"><span>•</span></div><div class="now-playing"><h3>${escape(m.current?.title || 'Sıradaki parça senden')}</h3><p>${escape(m.current?.author || 'YouTube, YouTube Music veya Spotify bağlantısı ekle.')}</p>${m.current ? `<span class="badge">${m.paused ? 'Duraklatıldı' : 'Çalıyor'} · ${duration(m.current.duration)}</span>` : ''}</div><div class="player-controls"><button class="button" data-control="${m.paused ? 'resume' : 'pause'}">${m.paused ? '▶ Devam' : 'Ⅱ Duraklat'}</button><button class="button" data-control="skip">Sonraki ⏭</button><button class="button danger" data-control="stop">■ Bitir</button></div><form id="volume-form" class="volume-row"><label for="volume">Ses</label><input id="volume" type="range" min="1" max="100" value="${Number(m.volume || s.musicVolume)}"><output id="volume-value">${Number(m.volume || s.musicVolume)}%</output><button class="button subtle">Uygula</button></form><div class="hint">Önce Discord’da bir ses kanalına katılın. Oynatıcıyı kontrol etmek için botla aynı kanalda olun.</div></section>
  <section class="card"><div class="card-header"><h3>Sıraya parça ekle</h3><span class="badge">YouTube Music</span></div><form id="play-form" class="form-stack"><div class="field"><label for="query">Şarkı adı veya bağlantı</label><div class="search-row"><input id="query" required maxlength="500" placeholder="Sanatçı, şarkı veya playlist bağlantısı"><button class="button primary" type="submit">+ Sıraya ekle</button></div></div></form><div class="hint">Spotify bağlantıları parça bilgisi için kullanılır; ses, YouTube üzerinden eşleştirilir. ${m.spotifyConfigured ? 'Spotify bağlantısı ayarlı.' : 'Spotify bağlantıları için sunucuda Spotify API ayarları gerekir.'}</div><div class="card-header response-toolbar"><h3>Çalma sırası</h3><span class="badge">${m.queue?.length || 0} parça</span></div>${m.queue?.length ? `<ol class="queue-list">${m.queue.map((track, index) => `<li class="queue-item"><span class="index">${String(index + 1).padStart(2, '0')}</span><div><strong>${escape(track.title)}</strong><small>${escape(track.author)}</small></div><span class="muted tiny">${duration(track.duration)}</span></li>`).join('')}</ol>` : empty('Kuyruk boş. İlk parçanı ekle.')}</section>
  <form id="music-settings-form" class="card wide"><div class="form-stack">${toggle('music-enabled', 'Müzik modülü', 'Bu sunucuda müzik komutlarını ve oynatıcıyı etkinleştir.', s.musicEnabled)}<div class="grid-2"><div class="field"><label for="dj-role">DJ rolü</label><select id="dj-role">${roleOptions(s.djRoleId)}</select><small>Seçilirse müzik kontrollerini bu rol ve sunucu yöneticileri kullanır.</small></div><div class="field"><label for="default-volume">Varsayılan ses seviyesi</label><input id="default-volume" type="number" min="1" max="100" value="${s.musicVolume}" required></div></div></div><div class="form-actions"><button class="button primary">Müzik ayarlarını kaydet</button></div></form></div>`;
}
const logTypeNames = { 'settings.updated': 'Ayar değişikliği', 'member.join': 'Üye katıldı', 'member.leave': 'Üye ayrıldı', 'autorole.assigned': 'Otomatik rol', 'autorole.error': 'Rol hatası', 'leave.error': 'Ayrılma mesajı hatası', 'responder.sent': 'Otomatik cevap', 'command.executed': 'Komut işlendi', 'command.failed': 'Komut hatası', 'message.delete': 'Mesaj silindi', 'message.bulk_delete': 'Toplu silme', 'member.roles_update': 'Rol değişikliği', 'member.timeout_update': 'Zaman aşımı değişikliği', 'music': 'Müzik işlemi', 'music_error': 'Müzik hatası', 'community.error': 'Topluluk hatası' };
function logTable(logs) {
  return !logs.length ? empty('Henüz olay kaydı yok. Yeni hareketler burada görünür.') : `<div class="table-wrap"><table><thead><tr><th>TARİH / SAAT</th><th>KULLANICI / YETKİLİ</th><th>OLAY & DETAY</th></tr></thead><tbody>${logs.map(log => `<tr><td class="time">${date(log.createdAt)}</td><td><strong>${escape(log.actorName || log.details?.actorName || (log.actorId ? 'İsim çözümlenemedi' : 'Sistem / yetkili bilgisi yok'))}</strong><small class="muted">${escape(log.actorId || '')}</small></td><td class="log-message"><span class="badge">${escape(logTypeNames[log.type] || log.type)}</span><p>${escape(log.message)}</p>${log.details?.input ? `<p><strong>Yazılan:</strong> ${escape(log.details.input)}</p><p><strong>Botun yanıtı:</strong> ${escape(log.details.reply)}</p>` : ''}${log.details?.query ? `<p><strong>Müzik isteği:</strong> ${escape(log.details.query)}</p>` : ''}<details><summary>Tüm ayrıntılar</summary><pre>${escape(JSON.stringify(log.details || {}, null, 2))}</pre></details></td></tr>`).join('')}</tbody></table></div>`;
}
function renderLogs() { return `<section class="card"><div class="log-tools"><label for="log-type" class="sr-only">Olay türü</label><select id="log-type"><option value="">Tüm olaylar</option>${Object.entries(logTypeNames).map(([value, label]) => `<option value="${escape(value)}">${label}</option>`).join('')}</select><button class="button subtle" id="reload-logs">↻ Kayıtları yenile</button><span class="muted tiny">Son 30 gün · En fazla 10.000 kayıt</span></div><div id="log-table" class="muted">Kayıtlar yükleniyor…</div><div class="form-actions"><button id="more-logs" class="button subtle" hidden>Daha eski kayıtlar</button></div></section>`; }
function renderSettings() {
  const s = state.guild.settings, perms = state.guild.bot.permissions;
  const commands = [['/hatırlat · /hatırlatıcılar', 'Kişisel hatırlatma oluştur, listele veya iptal et.'], ['/sağlık-asistanı', 'Mola hatırlatmalarına katıl veya kapat.'], ['/bilet-kapat', 'Destek biletini kapat.'], ['/uyar · /savunma-yanıt', 'Üyeyi uyar veya özel savunmaya yanıt ver.'], ['/yardim', 'Tüm komutları ve kullanımını göster.'], ['/clear · /temizle', 'Son 1–100 mesajı yetki kontrolüyle temizle.'], ['/play', 'Şarkı ara veya müzik bağlantısı oynat.'], ['/pause · /resume', 'Müziği duraklat veya devam ettir.'], ['/skip · /stop', 'Parçayı atla veya müziği bitir.'], ['/queue · /volume', 'Çalma sırasını ve ses seviyesini yönet.'], ['/anket', 'Discord’un yerel anketini oluştur.'], ['/ping · /sunucu · /avatar', 'Bağlantı, sunucu ve kullanıcı bilgileri.']];
  return `<div class="grid-2"><form id="settings-form" class="card"><h3>Log kanalı</h3><p class="muted tiny">Olay kayıtlarını panelde her zaman görebilirsiniz. İsterseniz Discord’da bir kanala da gönderin.</p><div class="field"><label for="log-channel">Discord log kanalı</label><select id="log-channel">${channelOptions(s.logChannelId)}</select><small>Boş bırakırsanız yalnızca panel kayıtları tutulur.</small></div><div class="form-actions"><button class="button primary">Ayarları kaydet</button></div></form><section class="card"><h3>Bot izinleri</h3><p class="muted tiny">Sunucu düzeyindeki izinler. Kanal izinleri ayrıca geçerlidir.</p>${[['manageRoles', 'Rolleri Yönet'], ['manageMessages', 'Mesajları Yönet'], ['connect', 'Ses Kanalına Bağlan'], ['speak', 'Konuş'], ['moderateMembers', 'Üyeleri Zamanaşımına Uğrat'], ['viewAuditLog', 'Denetim Kaydını Görüntüle'], ['manageChannels', 'Kanalları Yönet'], ['createPrivateThreads', 'Özel Thread Oluştur'], ['manageThreads', 'Thread Yönet']].map(([key, label]) => `<div class="permission"><span>${label}</span>${badge(perms[key], 'Var', 'Eksik')}</div>`).join('')}</section><section class="card wide"><div class="card-header"><h3>Komut rehberi</h3><span class="badge">/ komutları</span></div><div class="command-list">${commands.map(([name, desc]) => `<div class="command-item"><code>${name}</code><p>${desc}</p></div>`).join('')}</div><div class="hint">Bot token’ı, OAuth2 ve müzik servisi anahtarları sunucunun özel yapılandırmasında tutulur. Panelde gösterilmez.</div></section></div>`;
}

function render() {
  if (!state.guild) return;
  $('#guild-name').textContent = state.guild.name;
  $('#view-title').textContent = titles[state.view];
  $('#page-label').textContent = titles[state.view];
  $$('.nav-button').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#view-content').innerHTML = greeting() + ({ overview: renderOverview, community: renderCommunity, responders: renderResponders, music: renderMusic, logs: renderLogs, settings: renderSettings, blacklist: renderBlacklist, protection: renderProtection, tickets: renderTickets, tools: renderTools, access: renderAccess })[state.view]();
  if (['blacklist', 'tickets', 'tools', 'access'].includes(state.view)) void loadFeatureRecords().catch(error => notice(error.message, true));
  if (state.view === 'overview') void loadLogs(false, true).catch(error => notice(error.message, true));
  if (state.view === 'logs') void loadLogs().catch(error => notice(error.message, true));
  if (state.view === 'community') updateLeavePreview();
}
async function loadGuild(guildId) {
  const version = ++guildLoadVersion;
  state.guild = null;
  $('#view-content').innerHTML = '<div class="loading">Sunucu bilgileri yükleniyor…</div>';
  const guild = await api(`/api/guilds/${guildId}`);
  if (version !== guildLoadVersion) return;
  state.guild = guild; state.dirty = false; render();
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
    if (button.dataset.view || button.dataset.go) { if (state.guild) changeView(button.dataset.view || button.dataset.go); return; }
    if (button.id === 'refresh') { if (state.guild && (!state.dirty || confirm('Kaydedilmemiş değişiklikleri silip yenilemek istiyor musunuz?'))) await loadGuild(state.guild.id); }
    if (button.id === 'logout') { await api('/auth/logout', { method: 'POST', body: '{}' }); location.reload(); }
    if (button.id === 'add-response') { if ($$('.response-row').length >= 50) throw new Error('En fazla 50 otomatik cevap ekleyebilirsiniz.'); $('#responses').insertAdjacentHTML('beforeend', responseRow()); $('#responses-empty').hidden = true; state.dirty = true; $('#responses').lastElementChild.querySelector('input').focus(); }
    if (button.classList.contains('remove-response')) { button.closest('.response-row').remove(); $('#responses-empty').hidden = Boolean($$('.response-row').length); state.dirty = true; }
    if (button.id === 'reload-logs') await loadLogs();
    if (button.id === 'more-logs') await loadLogs(true);
    if (button.id === 'publish-ticket') { await guildApi('tickets', { method: 'POST', body: '{}' }); notice('Destek düğmesi seçilen kanala yayımlandı.'); }
    if (button.dataset.removeRecord) { await guildApi(button.dataset.resource, { method: 'DELETE', body: JSON.stringify(button.dataset.resource === 'blacklist' ? { userId: button.dataset.removeRecord } : { id: button.dataset.removeRecord }) }); await loadFeatureRecords(); notice('Kayıt güncellendi.'); }
    if (button.dataset.control) { button.disabled = true; state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: button.dataset.control }) }); render(); notice('Oynatıcı güncellendi.'); }
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.closest('form') && !event.target.closest('#play-form,#volume-form')) state.dirty = true;
  if (event.target.id === 'leave-message') updateLeavePreview();
  if (event.target.id === 'volume') $('#volume-value').textContent = `${event.target.value}%`;
});
document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'guild-select') { const old = state.guild?.id; if (state.dirty && !confirm('Kaydedilmemiş değişikliklerden vazgeçmek istiyor musunuz?')) { event.target.value = old; return; } await loadGuild(event.target.value); notice(''); }
    if (event.target.id === 'log-type') await loadLogs();
  } catch (error) { notice(error.message, true); }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, button = $('button[type="submit"],button:not([type])', form);
  $('#guild-select').disabled = true;
  if (button) button.disabled = true;
  notice('');
  try {
    if (form.id === 'community-form') await saveSettings({ autoRoleEnabled: $('#auto-role-enabled').checked, autoRoleIds: selectedRoles('auto-role-ids'), leaveEnabled: $('#leave-enabled').checked, leaveChannelId: $('#leave-channel').value || null, leaveMessage: $('#leave-message').value });
    if (form.id === 'blacklist-settings') await saveSettings({ blacklistOnLeave: $('#blacklist-on-leave').checked });
    if (form.id === 'blacklist-add') { await guildApi('blacklist', { method: 'POST', body: JSON.stringify({ userId: $('#blacklist-user').value.trim(), reason: $('#blacklist-reason').value.trim() }) }); form.reset(); state.dirty = false; await loadFeatureRecords(); notice('Kullanıcı blackliste eklendi.'); }
    if (form.id === 'protection-form') await saveSettings({ antiSpamEnabled: $('#anti-spam').checked, antiPhishingEnabled: $('#anti-phishing').checked, spamTimeoutMinutes: Number($('#spam-minutes').value), phishingDomains: $('#phishing-domains').value.split(/\s+/).filter(Boolean) });
    if (form.id === 'tickets-form') await saveSettings({ ticketEnabled: $('#ticket-enabled').checked, ticketChannelId: $('#ticket-channel').value || null, ticketCategoryId: $('#ticket-category').value || null, supportRoleId: $('#support-role').value || null, defenseEnabled: $('#defense-enabled').checked, defenseChannelId: $('#defense-channel').value || null });
    if (form.id === 'health-form') await saveSettings({ healthEnabled: $('#health-enabled').checked, healthHours: Number($('#health-hours').value) });
    if (form.id === 'access-form') await saveSettings({ musicRestricted: $('#music-restricted').checked, musicControllerRoleIds: selectedRoles('controller-roles'), musicControllerUserIds: $('#controller-users').value.split(/\s+/).filter(Boolean) });
    if (form.id === 'install-form') { await guildApi('access', { method: 'PUT', body: JSON.stringify({ guildIds: $('#allowed-guilds').value.split(/\s+/).filter(Boolean) }) }); state.dirty = false; notice('İzin verilen sunucular kaydedildi.'); }
    if (form.id === 'responders-form') await saveSettings({ responderEnabled: $('#responder-enabled').checked, responses: $$('.response-row').map(row => ({ trigger: $('[name="trigger"]', row).value.trim(), reply: $('[name="reply"]', row).value.trim() })) });
    if (form.id === 'music-settings-form') await saveSettings({ musicEnabled: $('#music-enabled').checked, musicVolume: Number($('#default-volume').value), djRoleId: $('#dj-role').value || null });
    if (form.id === 'settings-form') await saveSettings({ logChannelId: $('#log-channel').value || null });
    if (form.id === 'play-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'play', query: $('#query').value.trim() }) }); render(); notice('Parça çalma sırasına eklendi.'); }
    if (form.id === 'volume-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'volume', volume: Number($('#volume').value) }) }); notice('Ses seviyesi güncellendi.'); }
  } catch (error) { notice(error.message, true); }
  finally { if (button) button.disabled = false; $('#guild-select').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

Object.assign(logTypeNames, { 'panel.login': 'Panel girişi', 'settings.detail': 'Ayar ayrıntısı', 'discord.audit': 'Discord yetkili işlemi', 'blacklist.updated': 'Blacklist', 'protection.phishing': 'Oltalama engellendi', 'protection.spam': 'Spam engellendi', 'reminder.created': 'Hatırlatıcı oluşturuldu', 'reminder.sent': 'Hatırlatıcı gönderildi', 'reminder.failed': 'Hatırlatıcı hatası', 'health.sent': 'Mola hatırlatması', 'ticket.opened': 'Destek açıldı', 'ticket.closed': 'Destek kapandı', 'defense.opened': 'Savunma odası açıldı', 'defense.reply': 'Üye savunması', 'defense.staff_reply': 'Yetkili yanıtı', 'conversation.message': 'Özel oda mesajı', 'moderation.warning': 'Üye uyarıldı', 'access.updated': 'Kurulum yetkisi' });
function renderBlacklist() {
  return `<div class="grid-2"><form id="blacklist-settings" class="card form-stack">${toggle('blacklist-on-leave', 'Ayrılan üyeyi blackliste ekle', 'Kayıt tutulur; kişiyi otomatik yasaklamaz. Yeniden katılırsa kayıt korunur.', state.guild.settings.blacklistOnLeave)}<button class="button primary">Kaydet</button></form><form id="blacklist-add" class="card form-stack"><h3>Manuel kayıt ekle</h3><label>Kullanıcı kimliği<input id="blacklist-user" required pattern="[0-9]{17,20}" maxlength="20"></label><label>Sebep<input id="blacklist-reason" required maxlength="1000"></label><button class="button primary">Blackliste ekle</button></form><section class="card wide"><h3>Blacklist kayıtları</h3><div id="blacklist-records">Yükleniyor…</div></section></div>`;
}
function renderProtection() {
  const s = state.guild.settings, p = state.guild.protection || {};
  return `<form id="protection-form" class="form-stack"><div class="grid-2"><section class="card form-stack">${toggle('anti-spam', 'Aynı mesaj koruması', '3 saniye içinde aynı mesaj 5 kez gönderildiğinde mesajı sil ve timeout uygula. Mesaj yönetme yetkisi olanlar spam kontrolünden muaftır.', s.antiSpamEnabled)}<label>Spam timeout süresi (dakika)<input type="number" id="spam-minutes" min="1" max="1440" value="${s.spamTimeoutMinutes}" required></label></section><section class="card form-stack">${toggle('anti-phishing', 'Oltalama koruması', 'URL alan adlarını yerel güncel listeyle karşılaştır; eşleşmede mesajı sil, kullanıcıyı DM ile uyar ve 12 saat timeout uygula.', s.antiPhishingEnabled)}<p>${number(p.domains)} alan adı · Son güncelleme: ${date(p.updatedAt)}</p>${p.error ? `<p class="hint">${escape(p.error)}</p>` : ''}<p class="muted tiny">Discord-AntiScam listesi 15 dakikada bir yenilenir. Ağ, izin ve Discord hız sınırları nedeniyle milisaniyede silme garantisi yoktur. Yeni veya listelenmemiş saldırılar tespit edilmeyebilir.</p></section></div><section class="card"><label>Ek engellenecek alan adları (her satıra bir tane)<textarea id="phishing-domains" rows="7" placeholder="zararli-ornek.test">${escape(s.phishingDomains.join('\n'))}</textarea></label><p class="muted tiny">Tam alan adı ve alt alan adları eşleşir; benzer yazılan güvenli alan adları eşleşmez. URL veya yol eklemeyin.</p></section><div class="form-actions"><button class="button primary">Koruma ayarlarını kaydet</button></div></form>`;
}
function renderTickets() {
  const s = state.guild.settings;
  return `<form id="tickets-form" class="form-stack"><section class="card"><label>Destek yetkilisi rolü<select id="support-role">${roleOptions(s.supportRoleId).replace('Herkes kullanabilir', 'Destek rolünü seçin')}</select></label></section><div class="grid-2"><section class="card form-stack">${toggle('ticket-enabled', 'Özel destek biletleri', 'Kullanıcı ve destek rolü için özel metin kanalı açar.', s.ticketEnabled)}<label>Destek düğmesinin kanalı<select id="ticket-channel">${channelOptions(s.ticketChannelId)}</select></label><label>Bilet kategorisi<select id="ticket-category"><option value="">Kategori seçilmedi</option>${state.guild.channels.filter(c => c.type === 4).map(c => `<option value="${c.id}" ${s.ticketCategoryId === c.id ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label><button type="button" id="publish-ticket" class="button subtle">Kaydedilen kanala destek düğmesini yayımla</button></section><section class="card form-stack">${toggle('defense-enabled', 'Özel savunma thread’leri', '/uyar veya Discord timeout işleminden sonra özel thread oluştur.', s.defenseEnabled)}<label>Savunma ana kanalı<select id="defense-channel">${channelOptions(s.defenseChannelId, false, true)}</select></label><div class="hint">Timeout alan üyeler Discord thread’ine yazamaz. Botun DM düğmesiyle savunma iletirler; yetkililer /savunma-yanıt ile cevap verir. DM kapalıysa bu yol kullanılamaz. Admin ve Thread Yönet izni olan kişiler özel thread’leri görebilir.</div></section></div><div class="form-actions"><button class="button primary">Destek ayarlarını kaydet</button></div></form><section class="card"><h3>Biletler</h3><div id="tickets-records">Yükleniyor…</div></section><section class="card"><h3>Savunma kayıtları</h3><div id="cases-records">Yükleniyor…</div></section>`;
}
function renderTools() {
  const s = state.guild.settings;
  return `<div class="grid-2"><section class="card"><h3>Gelişmiş hatırlatıcı</h3><p><code>/hatırlat not:2 saat sonra NFS turnuvası var hedef:DM</code></p><p><code>/hatırlatıcılar</code> ile listele veya kimliğiyle iptal et.</p><p class="muted">1 dakika–365 gün. Kayıtlar yeniden başlatmada korunur. Bildirimler yaklaşık 15 saniyelik aralıklarla kontrol edilir; sunucu kapalı kaldıysa açıldığında gönderilir.</p></section><form id="health-form" class="card form-stack">${toggle('health-enabled', 'Sağlık asistanı', 'Kullanıcı /sağlık-asistanı durum:aç ile kişisel olarak katılır.', s.healthEnabled)}<label>Mola aralığı (saat)<input id="health-hours" type="number" min="1" max="12" value="${s.healthHours}" required></label><p class="muted tiny">Ses kanalı takibi açık. Oyun/Rich Presence takibi: ${state.guild.presenceEnabled ? 'açık' : 'Presence Intent bekliyor'}. Ekran etkinliği ölçülmez; Discord etkinliği esas alınır. Yeniden başlatmada kesintisiz oturum süresi sıfırlanır.</p><button class="button primary">Kaydet</button></form><section class="card wide"><h3>Hatırlatıcı kayıtları</h3><p class="muted tiny">Diğer kullanıcıların özel DM notları bu listede gizlenir.</p><div id="reminders-records">Yükleniyor…</div></section></div>`;
}
function renderAccess() {
  const s = state.guild.settings;
  return `<form id="access-form" class="card form-stack">${toggle('music-restricted', 'Müzik ve bağlantı kontrolünü yetkililere sınırla', 'Sunucuyu Yönet yetkisi, DJ rolü veya aşağıdaki yetkiler gerekir. Botla aynı ses kanalında bulunma şartı devam eder.', s.musicRestricted)}<label>Yetkili roller</label>${roleChecks('controller-roles', s.musicControllerRoleIds)}<label>Ek yetkili kullanıcı kimlikleri (her satıra bir tane)<textarea id="controller-users" rows="3">${escape(s.musicControllerUserIds.join('\n'))}</textarea></label><div class="hint">Discord’un sağ tık → Taşı işlemi Discord’daki Üyeleri Taşı yetkisine bağlıdır. Bot, bu yerel Discord iznini başka yöneticilerden kaldıramaz. Müzik komutları ve panel kontrolleri burada sınırlandırılır.</div><button class="button primary">Yetkileri kaydet</button></form>${state.me.installationOwner ? `<form id="install-form" class="card form-stack"><h3>İzin verilen kurulum sunucuları</h3><label>Sunucu kimlikleri<textarea id="allowed-guilds" rows="4" required></textarea></label><p class="muted tiny">Bu listeyi yalnızca bot sahibi düzenler. Bot diğer sunuculara eklendiğinde ayrılır. Discord Developer Portal’daki Public Bot kapalıysa kurulumu uygulama sahibi/ekibi yapabilir.</p><button class="button primary">Kurulum izinlerini kaydet</button></form>` : '<section class="card">Başka sunucuya kurulum izinlerini yalnızca bot sahibi yönetebilir.</section>'}`;
}
async function loadFeatureRecords() {
  const guildId = state.guild.id, view = state.view;
  if (view === 'access') { if (state.me.installationOwner) { const access = await guildApi('access'); if (state.guild?.id === guildId && $('#allowed-guilds')) $('#allowed-guilds').value = access.guildIds.join('\n'); } return; }
  for (const resource of view === 'blacklist' ? ['blacklist'] : view === 'tickets' ? ['tickets', 'cases'] : ['reminders']) {
    const items = await guildApi(resource);
    if (state.guild?.id !== guildId || state.view !== view) return;
    const node = $(`#${resource}-records`);
    if (!node) continue;
    node.innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>ÜYE</th><th>DETAY</th><th>TARİH / SAAT</th><th>İŞLEM</th></tr></thead><tbody>${items.map(item => `<tr><td>${escape(item.name || item.userId || item.id)}<small class="muted">${escape(item.userId || item.id)}</small></td><td>${escape(item.reason || item.text || item.status)}${item.dueAt ? `<p>Hatırlatma: ${date(item.dueAt)}</p>` : ''}${['tickets', 'cases'].includes(resource) ? `<a href="https://discord.com/channels/${guildId}/${item.id}" target="_blank" rel="noopener noreferrer">Discord’da aç</a>` : ''}</td><td>${date(item.createdAt)}</td><td>${resource === 'blacklist' || item.status === 'open' || (resource === 'reminders' && item.userId === state.me.user.id && item.status === 'pending') ? `<button class="button danger" data-resource="${resource}" data-remove-record="${escape(item.id)}">${resource === 'blacklist' ? 'Kaldır' : 'Kapat / iptal'}</button>` : escape(item.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('Henüz kayıt yok.');
  }
}
setInterval(() => { if ($('#local-clock')) $('#local-clock').textContent = date(Date.now()); }, 1000);

async function boot() {
  if (staticHosting) {
    $('#connection-label').textContent = 'GitHub Pages';
    if (livePanelUrl) {
      $('#login-link').href = `${livePanelUrl}/auth/login`;
      $('#setup-note').textContent = 'Discord girişi ve canlı ayarlar güvenli bot sunucusunda açılır.';
    } else {
      $('#login-link').hidden = true;
      $('#setup-note').textContent = 'Site yayında. Canlı yönetim panelinin açılması için bot sunucusu ve Discord erişim ayarları bekleniyor.';
    }
    return;
  }
  try {
    const status = await api('/api/status');
    $('#connection-dot').classList.toggle('online', status.ready);
    $('#connection-label').textContent = status.ready ? 'Discord bağlantısı aktif' : 'Discord bağlantısı bekleniyor';
    if (!status.loginConfigured) { $('#login-link').hidden = true; $('#setup-note').textContent = 'Panel hazır. Discord OAuth2 bilgileri eklendiğinde güvenli giriş açılacak.'; }
    try { state.me = await api('/api/me'); } catch (error) { if (error.status !== 401) throw error; return; }
    state.csrf = state.me.csrf;
    $('#user-label').textContent = state.me.user.name;
    $('#logout').hidden = false;
    const guilds = await api('/api/guilds');
    if (!guilds.length) { $('#setup-note').textContent = 'Yönetebileceğiniz bir sunucu bulunamadı. Pit-Stop’u sunucunuza ekleyin ve Sunucuyu Yönet izninizi kontrol edin.'; $('#login-link').hidden = true; return; }
    $('#guild-select').innerHTML = guilds.map(guild => `<option value="${escape(guild.id)}">${escape(guild.name)}</option>`).join('');
    $('#guild-select').hidden = false; $('#login-panel').hidden = true; $('#workspace').hidden = false;
    await loadGuild(guilds[0].id);
  } catch (error) { notice(error.message, true); }
}
await boot();
setInterval(async () => {
  if (!state.guild || document.hidden || state.dirty) return;
  try {
    if (state.view === 'logs') await loadLogs();
    if (state.view === 'overview') await loadLogs(false, true);
    if (state.view === 'music' && !$('#query')?.value && !$('#view-content').contains(document.activeElement)) { const music = await guildApi('music'); state.guild.music = music; render(); }
  } catch { /* User-triggered refresh reports connection errors without interrupting editing. */ }
}, 15_000);
