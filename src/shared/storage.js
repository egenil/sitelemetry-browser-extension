// chrome.storage.local access and the pure helpers around it. Everything the
// extension remembers lives in local storage on this device: the API key is never
// written to the synced storage area, and results are kept per site origin.
import { DEFAULT_BASE_URL } from './links.js';

export const KEYS = Object.freeze({
  apiKey: 'apiKey',
  baseUrl: 'baseUrl',
  acknowledgedAt: 'ownershipAcknowledgedAt',
  jobs: 'jobs',
  results: 'results',
  plansCache: 'plansCache'
});
export const MAX_RESULTS = 50;

const area = () => globalThis.chrome?.storage?.local;

// The scheme, host and port of an http(s) page URL; null for anything else (browser pages, file:, ...).
export function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// The base URL is an https origin; paths, queries and trailing slashes are dropped.
export function normalizeBaseUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return DEFAULT_BASE_URL;
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('invalid'); }
  if (parsed.protocol !== 'https:') throw new Error('scheme');
  return parsed.origin;
}

export async function getSettings() {
  const stored = await area().get([KEYS.apiKey, KEYS.baseUrl, KEYS.acknowledgedAt]);
  return {
    apiKey: typeof stored[KEYS.apiKey] === 'string' ? stored[KEYS.apiKey] : '',
    baseUrl: typeof stored[KEYS.baseUrl] === 'string' && stored[KEYS.baseUrl] ? stored[KEYS.baseUrl] : DEFAULT_BASE_URL,
    acknowledgedAt: typeof stored[KEYS.acknowledgedAt] === 'number' ? stored[KEYS.acknowledgedAt] : null
  };
}

export async function saveSettings(partial) {
  const update = {};
  if ('apiKey' in partial) update[KEYS.apiKey] = String(partial.apiKey ?? '');
  if ('baseUrl' in partial) update[KEYS.baseUrl] = normalizeBaseUrl(partial.baseUrl);
  if ('acknowledgedAt' in partial) update[KEYS.acknowledgedAt] = partial.acknowledgedAt;
  await area().set(update);
}

export async function getJobs() {
  const stored = await area().get(KEYS.jobs);
  return stored[KEYS.jobs] && typeof stored[KEYS.jobs] === 'object' ? stored[KEYS.jobs] : {};
}

export async function getJob(origin) {
  return (await getJobs())[origin] || null;
}

export async function setJob(origin, job) {
  const jobs = await getJobs();
  if (job) jobs[origin] = job;
  else delete jobs[origin];
  await area().set({ [KEYS.jobs]: jobs });
}

export async function getResults() {
  const stored = await area().get(KEYS.results);
  return stored[KEYS.results] && typeof stored[KEYS.results] === 'object' ? stored[KEYS.results] : {};
}

export async function getResult(origin) {
  return (await getResults())[origin] || null;
}

// Keep the newest MAX_RESULTS entries so storage cannot grow without bound.
export function pruneResults(results, max = MAX_RESULTS) {
  const entries = Object.entries(results).sort((a, b) => (b[1]?.finishedAt || 0) - (a[1]?.finishedAt || 0));
  return Object.fromEntries(entries.slice(0, max));
}

export async function setResult(origin, entry) {
  const results = await getResults();
  if (entry) results[origin] = entry;
  else delete results[origin];
  await area().set({ [KEYS.results]: pruneResults(results) });
}

export async function getPlansCache() {
  const stored = await area().get(KEYS.plansCache);
  return stored[KEYS.plansCache] || null;
}

export const setPlansCache = (cache) => area().set({ [KEYS.plansCache]: cache });
