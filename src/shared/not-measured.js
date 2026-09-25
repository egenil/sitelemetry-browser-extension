// Text for the "What was not measured" entries of a result model. Pure functions
// over the stored entries ({ key, subs }), so results kept by earlier versions read
// the same way. The service reports module reasons in the report language it was
// asked for; the explanations here are chosen structurally from the module id and
// language-independent tokens in those reasons (HTTP status codes, numbers), so
// they work whatever language the service used. The service's own reason is
// always kept next to the explanation, and anything not recognised is shown as the
// status word and that reason, as before. Stored reasons can be longer than what
// is shown: the explanation is chosen from the whole reason, and the reason itself
// is shown shortened.
import { clip } from './outcome.js';

// Characters of a service reason shown in the popup and the AI prompt.
const SHOWN_REASONS_CHARS = 300;

// Module ids as the service reports them, with their message keys (_locales).
const MODULE_KEYS = Object.freeze({
  dns: 'moduleDns',
  'dns-email': 'moduleDnsEmail',
  rdap: 'moduleRdap',
  tls: 'moduleTls',
  'http-headers': 'moduleHttpHeaders',
  'mitm-posture': 'moduleMitmPosture',
  'tech-fingerprint': 'moduleTechFingerprint',
  'http-methods': 'moduleHttpMethods',
  exposure: 'moduleExposure',
  'api-exposure': 'moduleApiExposure',
  'auth-surface': 'moduleAuthSurface',
  'supply-chain': 'moduleSupplyChain',
  wordpress: 'moduleWordpress',
  ports: 'modulePorts',
  'port-intel': 'modulePortIntel',
  'sql-injection': 'moduleSqlInjection',
  'ddos-resilience': 'moduleDdosResilience',
  'secret-exposure': 'moduleSecretExposure',
  'subdomain-takeover': 'moduleSubdomainTakeover',
  'cors-audit': 'moduleCorsAudit',
  'injection-canary': 'moduleInjectionCanary',
  'transport-delivery': 'moduleTransportDelivery',
  'pentest-suite': 'modulePentestSuite',
  'engine-nmap': 'moduleEngineNmap',
  'engine-nuclei': 'moduleEngineNuclei',
  'engine-zap': 'moduleEngineZap',
  'engine-wpscan': 'moduleEngineWpscan'
});
// The modules in the order sitelemetry.com lists them.
export const MODULE_IDS = Object.freeze(Object.keys(MODULE_KEYS));
const STATUS_KEYS = Object.freeze({ unavailable: 'nmNotMeasured', partial: 'nmPartlyMeasured' });

// Modules that probe well-known paths (/.env, /graphql, /admin, /package.json...).
const PATH_MODULES = new Set(['exposure', 'api-exposure', 'auth-surface', 'supply-chain']);
const PORT_MODULES = new Set(['ports', 'port-intel']);
// The service's own "no response" wording in each report language it supports.
const NO_RESPONSE = Object.freeze([
  'No response/timeout', 'Yanıt yok/timeout', 'Sin respuesta/tiempo agotado', 'Keine Antwort/Zeitüberschreitung',
  'Aucune réponse/délai dépassé', 'Sem resposta/tempo esgotado', 'Nessuna risposta/timeout', '応答なし/タイムアウト', '无响应/超时'
]);

// A translated label, or the id itself when there is none (unknown modules).
function label(keys, id, t) {
  const key = keys[id];
  if (!key) return String(id ?? '');
  const text = t(key);
  return text === key ? String(id) : text;
}

export const moduleLabel = (id, t) => label(MODULE_KEYS, id, t);
export const moduleStatusLabel = (status, t) => label(STATUS_KEYS, status, t);
const moduleList = (text, t) => String(text ?? '').split(/\s*,\s*/).filter(Boolean).map((id) => moduleLabel(id, t)).join(', ');

function explainPaths(text, t) {
  const codes = [...text.matchAll(/\bHTTP\s*(\d{3})\b/gu)].map((match) => Number(match[1]));
  const noResponse = NO_RESPONSE.some((phrase) => text.includes(phrase));
  if (!codes.length && !noResponse) return null;
  const redirect = (code) => code >= 300 && code < 400;
  const serverError = (code) => code >= 500 && code < 600;
  // Any other status (an ambiguous 4xx, a 2xx soft-404) has no explanation here.
  if (codes.some((code) => !redirect(code) && code !== 429 && !serverError(code))) return null;
  const redirects = [...new Set(codes.filter(redirect))].sort((a, b) => a - b);
  const parts = [];
  if (redirects.length) parts.push(t('explainRedirect', [redirects.join('/')]));
  if (codes.includes(429)) parts.push(t('explainRateLimited'));
  if (codes.some(serverError)) parts.push(t('explainServerError'));
  if (noResponse) parts.push(t('explainNoResponse'));
  return parts.join(' ');
}

// "12 timeout/filtered; 0 network error" in every report language: the first count
// is the ports that gave no reply, the second the ports with a network error. Only
// silent ports without network errors are explained: a network error, or a reason
// without the counts (a source scan that did not complete), can have other causes
// and is shown as the service reported it.
function explainPorts(text, t) {
  const counts = (text.match(/\d+/gu) || []).map(Number);
  if (counts.length !== 2 || counts[0] < 1 || counts[1] !== 0) return null;
  return t(counts[0] === 1 ? 'explainPortsOne' : 'explainPorts', [counts[0]]);
}

// "0/7 resource(s) could not be assessed; 7 script(s) remained outside the bounded
// scan." in every report language: a resource fraction first and, as the last
// segment, the number of scripts left outside the scan. A last segment that is part
// of the failure list (a URL, an HTTP status, a closing parenthesis) or was cut off
// does not count.
function scriptsLeftOut(text) {
  const segments = text.split(/[;；]/u);
  if (segments.length < 2 || !/\d+\s*\/\s*\d+/u.test(segments[0])) return false;
  const last = segments.at(-1).trim();
  if (/HTTP|:\/\/|[)）]\.?$|…$/u.test(last)) return false;
  const counts = last.match(/\d+/gu) || [];
  return counts.length === 1 && Number(counts[0]) > 0;
}

// The explanation for a module's reasons, or null when they are not recognised.
export function explainModule(module, reasons, t) {
  const text = String(reasons ?? '');
  if (!text.trim()) return null;
  if (PATH_MODULES.has(module)) return explainPaths(text, t);
  if (PORT_MODULES.has(module)) return explainPorts(text, t);
  if (module === 'secret-exposure') return scriptsLeftOut(text) ? t('explainScriptLimit') : null;
  return null;
}

// { text, explanation, detail } for one entry: the item itself, the explanation of
// its reason (or null) and, when there is an explanation, the service's own reason.
export function notMeasuredView(entry, t) {
  const subs = Array.isArray(entry?.subs) ? entry.subs : [];
  switch (entry?.key) {
    case 'nmModuleStatus':
    case 'nmModuleStatusReasons': {
      const [module, status, reasons = ''] = subs;
      const item = [moduleLabel(module, t), moduleStatusLabel(status, t)];
      const explanation = entry.key === 'nmModuleStatusReasons' ? explainModule(module, reasons, t) : null;
      const shown = clip(reasons, SHOWN_REASONS_CHARS);
      if (explanation) return { text: t('nmModuleStatus', item), explanation, detail: t('nmReasonDetail', [shown]) };
      return { text: entry.key === 'nmModuleStatusReasons' ? t('nmModuleStatusReasons', [...item, shown]) : t('nmModuleStatus', item), explanation: null, detail: null };
    }
    case 'nmModulesNotInPlan':
    case 'nmVerificationModules':
      return { text: t(entry.key, [moduleList(subs[0], t)]), explanation: null, detail: null };
    default:
      return { text: t(entry?.key, subs), explanation: null, detail: null };
  }
}

// The same entry as one line of plain text (the AI fix prompt).
export function notMeasuredText(entry, t) {
  const view = notMeasuredView(entry, t);
  return view.explanation ? t('nmExplainedLine', [view.text, view.explanation, view.detail]) : view.text;
}
