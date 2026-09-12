import { domainToASCII } from 'node:url';

export const PHISHING_FEED = 'https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.json';
export function extractHosts(content) {
  const links = String(content).match(/(?:https?:\/\/|www\.)[^\s<>]+/gi) || [];
  return [...new Set(links.slice(0, 40).flatMap(link => {
    try { const cleaned = link.replace(/[)\]},.!?;:'"]+$/, ''); return [domainToASCII(new URL(cleaned.startsWith('www.') ? `https://${cleaned}` : cleaned).hostname).toLowerCase().replace(/\.$/, '')]; }
    catch { return []; }
  }))];
}
export function blockedHost(host, domains) {
  const parts = host.split('.');
  while (parts.length > 1) { if (domains.has(parts.join('.'))) return true; parts.shift(); }
  return false;
}
export function createSpamDetector({ now = Date.now } = {}) {
  const entries = new Map();
  return {
    hit(key, content) {
      const time = now();
      const normalized = content.normalize('NFKC').trim().toLocaleLowerCase('tr-TR');
      if (!normalized) return false;
      const recent = (entries.get(key) || []).filter(item => time - item.time <= 3000);
      recent.push({ time, content: normalized }); entries.set(key, recent.slice(-30));
      if (entries.size > 10000) entries.delete(entries.keys().next().value);
      return recent.filter(item => item.content === normalized).length >= 5;
    },
    clear(key) { entries.delete(key); },
    prune() { for (const [key, items] of entries) if (now() - items.at(-1).time > 3000) entries.delete(key); },
  };
}

export function parseReminder(input, now = Date.now()) {
  const match = /^\s*(\d+)\s*(dakika|dk|saat|sa|gün|gun)\s+(?:sonra\s+)?(.{1,1500})$/isu.exec(input || '');
  if (!match) throw new Error('Örnek: /hatırlat not:2 saat sonra NFS turnuvası var');
  const units = { dakika: 60000, dk: 60000, saat: 3600000, sa: 3600000, gün: 86400000, gun: 86400000 };
  const delay = Number(match[1]) * units[match[2].toLocaleLowerCase('tr-TR')];
  if (!Number.isSafeInteger(delay) || delay < 60000 || delay > 365 * 86400000) throw new Error('Süre 1 dakika ile 365 gün arasında olmalı.');
  return { dueAt: now + delay, text: match[3].trim() };
}
