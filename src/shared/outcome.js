// Turn a raw audit outcome into one normalized, serializable model. No user-facing
// text is produced here: the model carries statuses, reasons and message keys, and
// the popup renders them through the translator (src/shared/text.js).
import { McpHttpError, McpRpcError } from './mcp-client.js';

export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
export const STATUSES = Object.freeze(['completed', 'partial', 'blocked', 'quota_exhausted', 'plan_required', 'verification_required']);

// Pre-execution gates the server reports as status "action_required".
const REASON_STATUS = Object.freeze({
  entitlement_required: 'plan_required',
  usage_limit_reached: 'quota_exhausted',
  target_verification_required: 'verification_required',
  target_reverification_required: 'verification_required',
  verification_scope_required: 'verification_required',
  authorization_consent_required: 'verification_required'
});
const PLAN_TEXT = /requires (?:starter|professional|enterprise)(?: or higher)? access|not included in (?:the connected|free|the current plan|your plan)|upgrade your plan/i;
const QUOTA_TEXT = /monthly .*limit reached|allowance is exhausted|usage limit reached/i;
const VERIFY_TEXT = /ownership|verif(?:y|ied|ication)|authorization terms/i;

export function statusFromText(text, code) {
  if (code === 'PLAN_UPGRADE_REQUIRED' || PLAN_TEXT.test(text)) return 'plan_required';
  if (code === 'COMMERCIAL_USAGE_LIMIT_REACHED' || QUOTA_TEXT.test(text)) return 'quota_exhausted';
  if (VERIFY_TEXT.test(text)) return 'verification_required';
  return 'blocked';
}

export const clip = (value, max = 400) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const urlOrNull = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null);
function pick(object, paths) {
  for (const path of paths) {
    let value = object;
    for (const key of path.split('.')) value = value?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

// FNV-1a: a stable short id for findings without a server key (no crypto needed).
export function shortHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function normalizeFinding(raw, index = 0) {
  const severity = SEVERITIES.includes(raw?.severity) ? raw.severity : 'info';
  const title = clip(raw?.title || 'Untitled finding', 200);
  const id = typeof raw?.findingKey === 'string' && raw.findingKey ? raw.findingKey : `finding-${index}-${shortHash(title)}`;
  return {
    id,
    severity,
    title,
    evidence: clip(raw?.evidence, 1000),
    impact: clip(raw?.impact, 600),
    fix: clip(raw?.remediation || raw?.fix || raw?.recommendation, 800),
    category: clip(raw?.category, 80),
    location: clip(raw?.location || raw?.url || raw?.path, 2048),
    pillar: clip(raw?.pillar, 40)
  };
}

export function countBySeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function sortBySeverity(findings) {
  return [...findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

// A module's reasons are kept longer than they are shown (not-measured.js shortens
// them for display): an explanation can depend on the end of a long reason, such as
// the scripts left outside the scan after a list of scripts that failed.
export const MAX_REASONS_CHARS = 2000;

// Everything the result says was skipped, unavailable or gated, as message keys
// with substitutions (see _locales). Unmeasured is not a pass.
export function notMeasuredEntries(structured) {
  const entries = [];
  const push = (key, subs = [], limits = []) => entries.push({ key, subs: subs.map((s, index) => clip(s, limits[index] ?? 300)) });
  for (const row of structured.failedPillars || []) push('nmPillarFailed', [row.pillar, row.error || 'failed']);
  const coverage = structured.auditDetails?.planCoverage;
  for (const row of coverage?.skippedPillars || []) push(row.reason === 'not_in_plan' ? 'nmPillarNotInPlan' : 'nmPillarOutOfScope', [row.pillar]);
  if (coverage?.skippedSecurityModules?.length) push('nmModulesNotInPlan', [coverage.skippedSecurityModules.join(', ')]);
  // A pillar that ran but could not measure keeps a null score; the server marks its scope unavailable.
  for (const [name, pillar] of Object.entries(structured.auditDetails?.pillars || {})) {
    if (pillar?.scope?.status === 'unavailable') push('nmPillarUnavailable', [name]);
  }
  const scopes = [structured.auditDetails?.scope, ...Object.values(structured.auditDetails?.pillars || {}).map((pillar) => pillar?.scope)];
  for (const scope of scopes.filter(Boolean)) {
    if (scope.verificationRequiredModules?.length) push('nmVerificationModules', [scope.verificationRequiredModules.join(', ')]);
    for (const row of scope.moduleResults || []) {
      if (!['unavailable', 'partial'].includes(row?.status)) continue;
      const reasons = (Array.isArray(row.reasons) ? row.reasons : [row.reason]).filter((reason) => typeof reason === 'string' && reason.trim());
      if (reasons.length) push('nmModuleStatusReasons', [row.module, row.status, reasons.join('; ')], [300, 300, MAX_REASONS_CHARS]);
      else push('nmModuleStatus', [row.module, row.status]);
    }
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const id = JSON.stringify([entry.key, entry.subs]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// The checks that passed (status "ok"), as the service lists them in
// auditDetails.checks.items in the report language, kept with the result so the
// popup can list them: only what the popup shows (the id, which places the check
// in its module, the title and the evidence). Bounded by a number of items and of
// characters, so a large audit keeps the stored result small; the service's
// passingChecks count still says how many there are, and the popup says how many
// were counted but not kept.
export const MAX_PASSING_ITEMS = 300;
export const MAX_PASSING_CHARS = 40_000;

export function passingEntries(structured) {
  const items = structured.auditDetails?.checks?.items;
  const entries = [];
  let chars = 0;
  for (const row of Array.isArray(items) ? items : []) {
    if (row?.status !== 'ok') continue;
    const entry = { id: clip(row.id, 120), title: clip(row.title, 180), evidence: clip(row.evidence, 300) };
    if (!entry.title && !entry.id) continue;
    chars += entry.id.length + entry.title.length + entry.evidence.length;
    if (entries.length >= MAX_PASSING_ITEMS || chars > MAX_PASSING_CHARS) break;
    entries.push(entry);
  }
  return entries;
}

function emptyModel(kind, target, tool, jobId) {
  return {
    kind, target, tool: tool || null, jobId: jobId || null, status: 'blocked', reason: null, message: '', httpStatus: null,
    score: null, grade: null, counts: countBySeverity([]), total: 0, returnedFindings: 0, truncated: false,
    findings: [], pillars: null, notMeasured: [], plan: null, remainingScans: null, reportUrl: null, passingChecks: null, passingItems: []
  };
}

// A problem the extension detected on its own, before or instead of a request: a
// blocked model whose reason selects a message from _locales. The message field
// stays empty because it is reserved for text the service actually sent.
export function blockedOutcome({ kind, target, tool = null, jobId = null, reason }) {
  return { ...emptyModel(kind, target, tool, jobId), reason };
}

export function interpretOutcome(run, { kind, target }) {
  const model = emptyModel(kind, target, run.tool, run.jobId);
  if (run.outcome === 'timeout') return { ...model, reason: 'timeout', message: '' };
  if (run.outcome === 'error') {
    const { error } = run;
    if (error instanceof McpHttpError) {
      // 401 is a rejected key. 403 is a refusal that can have other causes, so it is
      // reported as such. Both carry only the text of the service's JSON error body.
      if (error.status === 401) return { ...model, reason: 'unauthorized', httpStatus: 401, message: error.serviceMessage || '' };
      if (error.status === 403) return { ...model, reason: 'forbidden', httpStatus: 403, message: error.serviceMessage || '' };
      const status = error.status === 402 ? 'plan_required' : statusFromText(error.message, error.code);
      return { ...model, status: status === 'verification_required' ? 'blocked' : status, reason: error.code || `http_${error.status}`, httpStatus: error.status, message: error.message };
    }
    if (error instanceof McpRpcError) return { ...model, status: statusFromText(error.message, null), reason: `rpc_${error.code ?? 'error'}`, message: error.message };
    return { ...model, reason: 'transport', message: error?.message || String(error) };
  }
  const result = run.result || {};
  const text = (Array.isArray(result.content) ? result.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
  const structured = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : {};
  if (structured.status === 'action_required') {
    return { ...model, status: REASON_STATUS[structured.reason] || 'blocked', reason: structured.reason || 'action_required', message: text };
  }
  if (result.isError) return { ...model, status: statusFromText(text, null), reason: 'tool_error', message: text };
  if (structured.status === 'running') return { ...model, reason: 'incomplete', message: '' };

  const findings = (Array.isArray(structured.findings) ? structured.findings : []).map(normalizeFinding);
  const notMeasured = notMeasuredEntries(structured);
  const partial = structured.status === 'partial' || structured.complete === false
    || ['partial', 'unavailable'].includes(structured.coverageStatus) || notMeasured.length > 0;
  const serverCounts = structured.counts && typeof structured.counts === 'object' ? structured.counts : null;
  const counts = countBySeverity(findings);
  if (serverCounts) for (const severity of SEVERITIES) counts[severity] = numberOrNull(serverCounts[severity]) ?? counts[severity];
  const total = numberOrNull(structured.total) ?? findings.length;
  const plan = pick(structured, ['auditDetails.scope.plan', 'auditDetails.planCoverage.plan'])
    || Object.values(structured.auditDetails?.pillars || {}).map((pillar) => pillar?.scope?.plan).find(Boolean) || null;
  return {
    ...model,
    status: partial ? 'partial' : 'completed',
    message: text,
    score: numberOrNull(structured.score ?? structured.blended),
    grade: typeof structured.grade === 'string' ? structured.grade : null,
    counts,
    total,
    returnedFindings: findings.length,
    truncated: structured.findingsTruncated === true || findings.length < total,
    findings,
    pillars: structured.pillars && typeof structured.pillars === 'object' ? structured.pillars : null,
    notMeasured,
    plan: typeof plan === 'string' ? plan : null,
    remainingScans: numberOrNull(pick(structured, ['usage.remaining.securityScans', 'remainingSecurityScans', 'allowance.remaining.securityScans'])),
    reportUrl: urlOrNull(pick(structured, ['reportUrl', 'report.url', 'links.report'])),
    passingChecks: numberOrNull(structured.passingChecks),
    passingItems: passingEntries(structured)
  };
}

export const isMeasured = (model) => model.status === 'completed' || model.status === 'partial';
