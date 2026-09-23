const safe = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const pct = (value, total) => Math.max(0, Math.min(100, total ? value / total * 100 : 0));

function position(index, compact) {
  if (compact) return [27 + (index % 5) * 13.5 + Math.floor(index / 5) * 2.5, 31 + Math.floor(index / 5) * 16];
  return [[40, 32], [63, 35], [29, 53], [51, 55], [74, 53], [43, 72]][index];
}

export function renderGarageInteractive(garage, vehicles = {}, { activity, world, now = Date.now() } = {}) {
  const slots = Math.min(15, Math.max(1, garage?.capacity == null ? 15 : Number(garage.capacity) || 1));
  const compact = slots > 6, cars = vehicles.vehicles || [];
  const bays = Array.from({ length: slots }, (_, index) => {
    const car = cars[index], [x, y] = position(index, compact);
    const needs = Object.entries(car?.status === 'broken' ? car.model?.parts || {} : {});
    const required = needs.reduce((sum, [, count]) => sum + Number(count), 0);
    const available = needs.reduce((sum, [id, count]) => sum + Math.min(Number(count), Number(vehicles.depot?.[id] || 0)), 0);
    const ready = car?.status === 'broken' ? pct(available, required) : car ? 100 : 0;
    const label = car ? `${car.model?.name || 'Araç'} · ${car.status === 'broken' ? 'Tamir bekliyor' : 'Tamirli'}` : `${index + 1}. araç yuvası boş`;
    return `<button type="button" class="rpg-scene-bay ${car ? `occupied ${car.status === 'broken' ? 'needs-repair' : 'repaired'}` : 'empty'}" data-rpg-scene-bay="${index}" style="--bay-x:${x}%;--bay-y:${y}%" aria-label="${safe(label)}"><span class="rpg-scene-bay-shape"></span>${car ? `<span class="rpg-scene-car" aria-hidden="true">${safe(car.model?.symbol || '🚗')}</span><span class="rpg-scene-bay-name">${safe(car.model?.name || 'Araç')}</span><span class="rpg-scene-progress" role="progressbar" aria-label="${car.status === 'broken' ? 'Gerekli parçalar hazır' : 'Tamir tamamlandı'}" aria-valuenow="${Math.round(ready)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${ready}%"></i></span>` : `<span class="rpg-scene-bay-number">${String(index + 1).padStart(2, '0')}</span>`}</button>`;
  }).join('');
  const shift = activity?.type === 'work' && Number.isFinite(Number(activity.startedAt)) && Number.isFinite(Number(activity.endsAt)) && Number(activity.endsAt) > Number(activity.startedAt) ? activity : null;
  const recent = vehicles.recentJob && now - Number(vehicles.recentJob.completedAt) < 90_000 ? vehicles.recentJob : null;
  const recentModel = recent && (vehicles.models || []).find(model => model.id === recent.modelId);
  const shiftProgress = shift ? pct(now - Number(shift.startedAt), Number(shift.endsAt) - Number(shift.startedAt)) : 0;
  const service = shift ? `<div class="rpg-scene-service busy" aria-label="Vardiya sürüyor"><span class="rpg-scene-car" aria-hidden="true">🚗</span><span>Vardiyada</span><span class="rpg-scene-progress" role="progressbar" aria-label="Vardiya ilerlemesi" aria-valuenow="${Math.round(shiftProgress)}" aria-valuemin="0" aria-valuemax="100" data-rpg-scene-progress data-started-at="${Number(shift.startedAt)}" data-ends-at="${Number(shift.endsAt)}"><i style="width:${shiftProgress}%"></i></span></div>` : recentModel ? `<div class="rpg-scene-service completed" aria-label="Son müşteri tamiri tamamlandı"><span class="rpg-scene-car" aria-hidden="true">${safe(recentModel.symbol)}</span><span>Tamir tamamlandı</span><span class="rpg-scene-progress"><i style="width:100%"></i></span></div>` : '';
  const installed = (garage?.upgrades || []).filter(item => (item.owned || item.readyAt) && item.price);
  const mounts = installed.filter(item => (item.equipped || item.category === 'facility' && item.owned) && ['tools', 'lift', 'diagnostic', 'facility', 'tow'].includes(item.category)).map((item, index) => `<button type="button" class="rpg-scene-mount ${Number(item.durability ?? 100) < 30 ? 'worn' : ''}" style="--mount-index:${index}" data-rpg-scene-gear="${safe(item.id)}" title="${safe(item.name)}" aria-label="${safe(item.name)} ekipmanını incele"><span aria-hidden="true">${safe(item.symbol)}</span></button>`).join('');
  const chips = installed.map(item => `<button type="button" class="rpg-scene-gear-chip ${item.readyAt ? 'shipping' : ''} ${Number(item.durability ?? 100) < 30 ? 'worn' : ''}" data-rpg-scene-gear="${safe(item.id)}" title="${safe(item.name)}"><b aria-hidden="true">${safe(item.symbol)}</b><small>${safe(item.name)}</small>${item.readyAt ? '<em>Kargoda</em>' : `<span class="rpg-scene-gear-durability"><i style="width:${pct(Number(item.durability ?? 100), 100)}%"></i></span>`}</button>`).join('') || '<span class="rpg-scene-gear-empty">Başlangıç ekipmanları kurulu</span>';
  return `<div class="rpg-garage-interactive ${world?.night ? 'is-night' : 'is-day'} ${compact ? 'is-compact' : ''} ${Number(garage?.employee?.morale ?? 100) < 30 ? 'is-warning' : ''}"><div class="rpg-scene-bays">${bays}</div>${service}${mounts}</div><div class="rpg-garage-installed">${chips}</div><div class="rpg-scene-popover" id="rpg-garage-popover" hidden><button type="button" class="rpg-scene-popover-close" data-rpg-scene-close aria-label="Kapat">×</button><strong data-rpg-scene-title></strong><p data-rpg-scene-detail></p><div class="rpg-scene-popover-meter" hidden><span data-rpg-scene-meter-label></span><span class="rpg-scene-progress"><i data-rpg-scene-meter></i></span></div><button type="button" class="rpg-text-link" data-rpg-section="vehicles" data-rpg-scene-vehicles>Araçlarım →</button></div>`;
}
