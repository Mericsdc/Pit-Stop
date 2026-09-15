const HOUR = 60 * 60_000;
const RETENTION = 49 * HOUR;
const TIME_ZONE = 'Europe/Istanbul';

const hourStart = value => Math.floor(Number(value) / HOUR) * HOUR;
const dayKey = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));
const hourLabel = value => new Intl.DateTimeFormat('tr-TR', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));

export function recordDashboardActivity(store, { guildId, channelId = null, kind, at = Date.now() }) {
  if (!guildId || !['message', 'command'].includes(kind)) return;
  const capturedAt = hourStart(at), id = String(capturedAt);
  store.updateRecord(guildId, 'dashboard_activity', id, current => {
    const next = current || { capturedAt, messages: 0, commands: 0, channels: {} };
    next[kind === 'message' ? 'messages' : 'commands'] = Number(next[kind === 'message' ? 'messages' : 'commands'] || 0) + 1;
    if (kind === 'message' && channelId) next.channels[channelId] = Number(next.channels[channelId] || 0) + 1;
    return next;
  });
  if (capturedAt % (6 * HOUR) === 0) {
    for (const item of store.listRecords(guildId, 'dashboard_activity', 100)) {
      if (Number(item.capturedAt) < capturedAt - RETENTION) store.deleteRecord(guildId, 'dashboard_activity', item.id);
    }
  }
}

export function dashboardActivitySummary(store, guildId, channelNames = new Map(), now = Date.now()) {
  const currentHour = hourStart(now), start = currentHour - 23 * HOUR;
  const records = store.listRecords(guildId, 'dashboard_activity', 100);
  const byHour = new Map(records.map(item => [Number(item.capturedAt), item]));
  const series = Array.from({ length: 24 }, (_, index) => {
    const capturedAt = start + index * HOUR, item = byHour.get(capturedAt);
    const messages = Number(item?.messages || 0), commands = Number(item?.commands || 0);
    return { capturedAt, label: hourLabel(capturedAt), messages, commands, total: messages + commands };
  });
  const today = dayKey(now), todayRecords = records.filter(item => dayKey(item.capturedAt) === today);
  const todayMessages = todayRecords.reduce((total, item) => total + Number(item.messages || 0), 0);
  const todayCommands = todayRecords.reduce((total, item) => total + Number(item.commands || 0), 0);
  const channelTotals = new Map();
  for (const item of records.filter(record => Number(record.capturedAt) >= start)) {
    for (const [channelId, count] of Object.entries(item.channels || {})) {
      if (channelNames.has(channelId)) channelTotals.set(channelId, Number(channelTotals.get(channelId) || 0) + Number(count || 0));
    }
  }
  const activeChannelId = [...channelTotals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  const peak = [...series].sort((left, right) => right.total - left.total)[0];
  const currentTotal = series.reduce((total, item) => total + item.total, 0);
  const previousStart = start - 24 * HOUR;
  const previousTotal = records.filter(item => Number(item.capturedAt) >= previousStart && Number(item.capturedAt) < start)
    .reduce((total, item) => total + Number(item.messages || 0) + Number(item.commands || 0), 0);
  return {
    todayMessages,
    todayCommands,
    series,
    activeChannel: activeChannelId ? { id: activeChannelId, name: channelNames.get(activeChannelId), activity: channelTotals.get(activeChannelId) } : null,
    peakHour: peak?.total ? { label: peak.label, activity: peak.total } : null,
    changePercent: previousTotal > 0 ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100) : null,
    hasActivity: currentTotal > 0,
  };
}
