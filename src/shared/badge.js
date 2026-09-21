// Toolbar badge: the last measured score for the site in a tab, or an ellipsis
// while an audit for that site is running. Badges are set per tab; Chrome clears a
// tab's badge when the tab navigates.
import { isMeasured } from './outcome.js';

export function badgeColor(score) {
  if (score == null) return '#6B7280';
  if (score >= 80) return '#15803D';
  if (score >= 60) return '#B45309';
  return '#B91C1C';
}

export function badgeFor(entry, running = false) {
  if (running) return { text: '…', color: '#6B7280' };
  const model = entry?.model;
  if (!model || !isMeasured(model) || model.score == null) return { text: '', color: '#6B7280' };
  return { text: String(Math.round(model.score)), color: badgeColor(model.score) };
}

export async function applyBadge(tabId, entry, running = false) {
  const action = globalThis.chrome?.action;
  if (!action || typeof tabId !== 'number') return;
  const { text, color } = badgeFor(entry, running);
  try {
    await action.setBadgeText({ tabId, text });
    if (text) {
      await action.setBadgeBackgroundColor({ tabId, color });
      if (typeof action.setBadgeTextColor === 'function') await action.setBadgeTextColor({ tabId, color: '#FFFFFF' });
    }
  } catch {
    // The tab may have been closed in the meantime.
  }
}
