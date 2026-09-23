export function renderGarageScene(garage, vehicles = {}) {
  const level = Math.max(1, Math.min(10, Number(garage?.level) || 1));
  const capacity = garage?.capacity == null ? 16 : Math.min(16, Number(garage.capacity) || 1);
  const parked = Math.min(15, vehicles.occupied || 0);
  const slots = Math.min(15, Math.max(1, capacity));
  const compact = slots > 6;
  const hasLift = Boolean(garage?.equipped?.lift && garage.equipped.lift !== 'timsah-kriko');
  const hasPaint = (garage?.owned || []).includes('boya-kabini');
  const hasDiagnostics = Boolean(garage?.equipped?.diagnostic);
  const bays = Array.from({ length: slots }, (_, index) => {
    const x = compact ? 100 + (index % 5) * 132 + Math.floor(index / 5) * 28 : 90 + (index % 3) * 202 + (index >= 3 ? 54 : 0);
    const y = compact ? 65 + Math.floor(index / 5) * 77 : 78 + Math.floor(index / 3) * 92;
    return `<g transform="translate(${x} ${y}) scale(${compact ? '.72' : '1'})"><path d="M0 20 72 0 146 21 74 42Z" fill="${index < parked ? '#183845' : '#15252e'}" stroke="#567482" stroke-opacity=".7" stroke-width="2"/><path d="M9 22 72 6 135 22" fill="none" stroke="#72a9b0" stroke-opacity=".35"/>${index < parked ? `<g><path d="M28 18 65 5 113 17 78 30Z" fill="${index % 2 ? '#2d6673' : '#4c7483'}" stroke="#9bced3" stroke-width="2"/><path d="M48 13 68 7 89 12 69 18Z" fill="#091b25"/><path d="M34 23 42 21M96 26 105 23" stroke="#e4ffff" stroke-width="3"/></g>` : ''}</g>`;
  }).join('');
  return `<svg class="rpg-garage-isometric" viewBox="0 0 860 360" role="img" aria-label="Garaj seviye ${level}, ${vehicles.occupied || 0} araç, ${capacity === 16 ? 'sınırsız' : capacity} kapasite"><defs><linearGradient id="rpg-floor" x2="1" y2="1"><stop stop-color="#18313c"/><stop offset="1" stop-color="#0d1922"/></linearGradient></defs><path d="M0 158 420 15 860 151 442 321Z" fill="url(#rpg-floor)" stroke="#45707d" stroke-width="3"/><path d="M0 158 0 200 442 360 442 321ZM442 321 860 151 860 192 442 360Z" fill="#101e27" stroke="#375561" stroke-width="2"/><path d="M56 152 416 35 812 151" fill="none" stroke="#75dce3" stroke-opacity=".23" stroke-width="4"/>${bays}${hasLift ? '<g transform="translate(62 206)"><path d="M0 0 8 -53 18 -56 13 0M120 0 115 -53 105 -56 109 0M12 -14 109 -14" fill="none" stroke="#60d2db" stroke-width="7"/><path d="M10 0 112 0" stroke="#4a7f88" stroke-width="8"/></g>' : ''}${hasPaint ? '<g transform="translate(641 32)"><path d="M0 20 38 0 95 19 57 40Z" fill="#355e68" stroke="#83c6cf"/><path d="M9 22 9 57 57 76 57 40" fill="#1d3945" stroke="#477381"/><path d="M57 40 95 19 95 54 57 76" fill="#243f48" stroke="#477381"/><path d="M57 43 57 71" stroke="#63d8df" stroke-width="3"/></g>' : ''}${hasDiagnostics ? '<g transform="translate(680 213)"><path d="M0 14 29 0 55 12 27 26Z" fill="#28535c" stroke="#67ccd6"/><path d="M13 8 31 3 44 10 27 15Z" fill="#57bcc8"/></g>' : ''}<text x="794" y="315" text-anchor="end" fill="#a5c8d0" font-size="15" font-family="sans-serif">LV ${level} · ${vehicles.occupied || 0}/${garage?.capacity == null ? '∞' : capacity}</text></svg>`;
}
