import { staticHosting, livePanelUrl } from './site-config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { csrf: '', guild: null, view: 'overview', logs: [], dirty: false, me: null };
let guildLoadVersion = 0;
const titles = { overview: 'Genel bakış', community: 'Üyeler & roller', responders: 'Otomatik cevaplar', music: 'Müzik istasyonu', logs: 'Olay kayıtları', settings: 'Bot ayarları' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const check = value => value ? 'checked' : '';
const badge = (value, yes = 'Etkin', no = 'Kapalı') => `<span class="badge ${value ? 'on' : 'off'}">${value ? '●' : '○'} ${escape(value ? yes : no)}</span>`;
const number = value => Number(value || 0).toLocaleString('tr-TR');
const duration = ms => `${Math.floor((ms || 0) / 60000)}:${String(Math.floor((ms || 0) / 1000) % 60).padStart(2, '0')}`;
const uptime = seconds => seconds >= 86400 ? `${Math.floor(seconds / 86400)} gün` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} sa` : `${Math.floor(seconds / 60)} dk`;

function notice(message, error = false) { const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.hidden = !message; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, ...options.headers } });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'İşlem tamamlanamadı.'); error.status = response.status; throw error; }
  return body;
}
const guildApi = (resource = '', options) => api(`/api/guilds/${state.guild.id}${resource ? `/${resource}` : ''}`, options);
function channelOptions(selected, voice = false) {
  return `<option value="">Kanal seçin</option>` + state.guild.channels.filter(channel => voice ? channel.type === 2 : channel.type !== 2).map(channel => `<option value="${escape(channel.id)}" ${selected === channel.id ? 'selected' : ''}>${voice ? '♫' : '#'} ${escape(channel.name)}</option>`).join('');
}
function roleOptions(selected, assignable = false) {
  return `<option value="">${assignable ? 'Rol seçin' : 'Herkes kullanabilir'}</option>` + state.guild.roles.filter(role => !assignable || role.assignable).map(role => `<option value="${escape(role.id)}" ${selected === role.id ? 'selected' : ''}>${escape(role.name)}</option>`).join('');
}
const toggle = (id, title, description, enabled) => `<div class="switch-row"><div><label for="${id}">${title}</label><p>${description}</p></div><input type="checkbox" id="${id}" ${check(enabled)}></div>`;
const empty = message => `<div class="empty"><span class="empty-symbol" aria-hidden="true">◇</span>${escape(message)}</div>`;

function renderOverview() {
  const { settings: s, bot, memberCount, music } = state.guild;
  const active = [s.leaveEnabled, s.autoRoleEnabled, s.responderEnabled, s.musicEnabled].filter(Boolean).length;
  return `<div class="stats">
    <div class="card stat"><div class="stat-label">Toplam üye <span class="stat-icon">♧</span></div><div class="stat-value">${number(memberCount)}</div><div class="stat-foot">Sunucunun güncel üye sayısı</div></div>
    <div class="card stat"><div class="stat-label">Bot gecikmesi <span class="stat-icon">ϟ</span></div><div class="stat-value">${number(bot.ping)} <small class="tiny muted">ms</small></div><div class="stat-foot">${bot.ready ? 'Discord bağlantısı aktif' : 'Discord’a bağlanıyor'}</div></div>
    <div class="card stat"><div class="stat-label">Etkin modüller <span class="stat-icon">⌘</span></div><div class="stat-value">${active}<small class="tiny muted"> / 4</small></div><div class="stat-foot">Sunucuna özel otomasyonlar</div></div>
    <div class="card stat"><div class="stat-label">Çalışma süresi <span class="stat-icon">◷</span></div><div class="stat-value">${uptime(bot.uptime)}</div><div class="stat-foot">Son başlatılmadan bu yana</div></div>
  </div><div class="grid-2"><section class="card"><div class="card-header"><h3>Sunucunun pit ekibi</h3><span class="badge">4 modül</span></div>
  ${[['↗', 'Otomatik rol', 'Yeni üyelere belirlediğin rolü ver.', s.autoRoleEnabled], ['↙', 'Ayrılma mesajları', 'Ayrılan üyeleri seçtiğin kanala bildir.', s.leaveEnabled], ['⌘', 'Otomatik cevaplar', `${s.responses.length} özel ! komutu hazır.`, s.responderEnabled], ['♫', 'Müzik istasyonu', 'YouTube Music ve Spotify bağlantıları.', s.musicEnabled]].map(([icon, name, description, enabled]) => `<div class="module-row"><div class="module-name"><span class="module-icon" aria-hidden="true">${icon}</span><div><strong>${name}</strong><p>${description}</p></div></div>${badge(enabled)}</div>`).join('')}
  <div class="quick-actions"><button class="button subtle" data-go="community">Üye ayarlarını düzenle ↗</button></div></section>
  <section class="card"><div class="card-header"><h3>Şimdi garajda çalıyor</h3>${badge(music.connected, 'Bağlı', 'Beklemede')}</div><div class="record" aria-hidden="true"><span>•</span></div><div class="now-playing"><h3>${escape(music.current?.title || 'Henüz bir parça çalmıyor')}</h3><p>${escape(music.current?.author || 'Ses kanalına katıl, müzik istasyonundan bir parça seç.')}</p></div><div class="quick-actions"><button class="button primary" data-go="music">Müzik istasyonunu aç ♫</button></div></section>
  <section class="card wide"><div class="card-header"><h3>Son hareketler</h3><button class="button subtle" data-go="logs">Tüm kayıtlar ↗</button></div><div id="recent-logs" class="muted">Kayıtlar yükleniyor…</div></section></div>`;
}

function renderCommunity() {
  const s = state.guild.settings;
  return `<form id="community-form"><div class="grid-2"><section class="card form-stack">${toggle('auto-role-enabled', 'Otomatik rol', 'Sunucuya katılan üyelere otomatik rol ver.', s.autoRoleEnabled)}<div class="field"><label for="auto-role-id">Verilecek rol</label><select id="auto-role-id">${roleOptions(s.autoRoleId, true)}</select><small>Yalnızca sizin ve botun yönetebileceği roller listelenir.</small></div><div class="hint">Botun rolünü verilecek rolün üzerinde tutun ve Rolleri Yönet iznini açın. Mevcut üyeler değişmez.</div></section>
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
const logTypeNames = { 'settings.updated': 'Ayar değişikliği', 'member.join': 'Üye katıldı', 'member.leave': 'Üye ayrıldı', 'autorole.assigned': 'Otomatik rol', 'autorole.skipped': 'Rol atlandı', 'autorole.failed': 'Rol hatası', 'responder.sent': 'Otomatik cevap', 'command.executed': 'Komut işlendi', 'command.failed': 'Komut hatası', 'message.update': 'Mesaj düzenlendi', 'message.delete': 'Mesaj silindi', 'message.bulk_delete': 'Toplu silme', 'member.roles_update': 'Rol değişikliği', 'member.timeout_update': 'Zaman aşımı değişikliği', 'music.play': 'Müzik çalma', 'music.pause': 'Müzik duraklatma', 'music.resume': 'Müzik devam', 'music.skip': 'Parça atlandı', 'music.stop': 'Müzik bitirildi', 'music.volume': 'Ses ayarı', 'music.error': 'Müzik hatası', 'community.error': 'Topluluk hatası' };
function logTable(logs) {
  return !logs.length ? empty('Henüz olay kaydı yok. Yeni hareketler burada görünür.') : `<div class="table-wrap"><table><thead><tr><th>ZAMAN</th><th>OLAY</th><th>DETAY</th></tr></thead><tbody>${logs.map(log => `<tr><td class="time">${new Date(log.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td><span class="badge">${escape(logTypeNames[log.type] || log.type)}</span></td><td class="log-message">${escape(log.message)}${log.actorId || (log.details && Object.keys(log.details).length) ? `<details><summary>Detayları göster</summary>${log.actorId ? `<p>Kullanıcı: ${escape(log.actorId)}</p>` : ''}<pre>${escape(JSON.stringify(log.details || {}, null, 2))}</pre></details>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderLogs() { return `<section class="card"><div class="log-tools"><label for="log-type" class="sr-only">Olay türü</label><select id="log-type"><option value="">Tüm olaylar</option>${Object.entries(logTypeNames).map(([value, label]) => `<option value="${escape(value)}">${label}</option>`).join('')}</select><button class="button subtle" id="reload-logs">↻ Kayıtları yenile</button><span class="muted tiny">Son 30 gün · En fazla 10.000 kayıt</span></div><div id="log-table" class="muted">Kayıtlar yükleniyor…</div><div class="form-actions"><button id="more-logs" class="button subtle" hidden>Daha eski kayıtlar</button></div></section>`; }
function renderSettings() {
  const s = state.guild.settings, perms = state.guild.bot.permissions;
  const commands = [['/yardim', 'Tüm komutları ve kullanımını göster.'], ['/clear · /temizle', 'Son 1–100 mesajı yetki kontrolüyle temizle.'], ['/play', 'Şarkı ara veya müzik bağlantısı oynat.'], ['/pause · /resume', 'Müziği duraklat veya devam ettir.'], ['/skip · /stop', 'Parçayı atla veya müziği bitir.'], ['/queue · /volume', 'Çalma sırasını ve ses seviyesini yönet.'], ['/anket', 'Discord’un yerel anketini oluştur.'], ['/ping · /sunucu · /avatar', 'Bağlantı, sunucu ve kullanıcı bilgileri.']];
  return `<div class="grid-2"><form id="settings-form" class="card"><h3>Log kanalı</h3><p class="muted tiny">Olay kayıtlarını panelde her zaman görebilirsiniz. İsterseniz Discord’da bir kanala da gönderin.</p><div class="field"><label for="log-channel">Discord log kanalı</label><select id="log-channel">${channelOptions(s.logChannelId)}</select><small>Boş bırakırsanız yalnızca panel kayıtları tutulur.</small></div><div class="form-actions"><button class="button primary">Ayarları kaydet</button></div></form><section class="card"><h3>Bot izinleri</h3><p class="muted tiny">Sunucu düzeyindeki izinler. Kanal izinleri ayrıca geçerlidir.</p>${[['manageRoles', 'Rolleri Yönet'], ['manageMessages', 'Mesajları Yönet'], ['connect', 'Ses Kanalına Bağlan'], ['speak', 'Konuş']].map(([key, label]) => `<div class="permission"><span>${label}</span>${badge(perms[key], 'Var', 'Eksik')}</div>`).join('')}</section><section class="card wide"><div class="card-header"><h3>Komut rehberi</h3><span class="badge">/ komutları</span></div><div class="command-list">${commands.map(([name, desc]) => `<div class="command-item"><code>${name}</code><p>${desc}</p></div>`).join('')}</div><div class="hint">Bot token’ı, OAuth2 ve müzik servisi anahtarları sunucunun özel yapılandırmasında tutulur. Panelde gösterilmez.</div></section></div>`;
}

function render() {
  if (!state.guild) return;
  $('#guild-name').textContent = state.guild.name;
  $('#view-title').textContent = titles[state.view];
  $('#page-label').textContent = titles[state.view];
  $$('.nav-button').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#view-content').innerHTML = ({ overview: renderOverview, community: renderCommunity, responders: renderResponders, music: renderMusic, logs: renderLogs, settings: renderSettings })[state.view]();
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
    if (form.id === 'community-form') await saveSettings({ autoRoleEnabled: $('#auto-role-enabled').checked, autoRoleId: $('#auto-role-id').value || null, leaveEnabled: $('#leave-enabled').checked, leaveChannelId: $('#leave-channel').value || null, leaveMessage: $('#leave-message').value });
    if (form.id === 'responders-form') await saveSettings({ responderEnabled: $('#responder-enabled').checked, responses: $$('.response-row').map(row => ({ trigger: $('[name="trigger"]', row).value.trim(), reply: $('[name="reply"]', row).value.trim() })) });
    if (form.id === 'music-settings-form') await saveSettings({ musicEnabled: $('#music-enabled').checked, musicVolume: Number($('#default-volume').value), djRoleId: $('#dj-role').value || null });
    if (form.id === 'settings-form') await saveSettings({ logChannelId: $('#log-channel').value || null });
    if (form.id === 'play-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'play', query: $('#query').value.trim() }) }); render(); notice('Parça çalma sırasına eklendi.'); }
    if (form.id === 'volume-form') { state.guild.music = await guildApi('music', { method: 'POST', body: JSON.stringify({ action: 'volume', volume: Number($('#volume').value) }) }); notice('Ses seviyesi güncellendi.'); }
  } catch (error) { notice(error.message, true); }
  finally { if (button) button.disabled = false; $('#guild-select').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

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
