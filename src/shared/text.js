// Text for a result model, produced through a translator so every string comes
// from _locales. Pure functions: the popup turns the returned pieces into DOM.
import { freePlan, paidPlans } from './plans.js';
import { APP_URL, PRICING_URL } from './links.js';
import { McpHttpError } from './mcp-client.js';
import { clip } from './outcome.js';

const STATUS_KEYS = Object.freeze({
  completed: 'statusCompleted',
  partial: 'statusPartial',
  blocked: 'statusBlocked',
  quota_exhausted: 'statusQuota',
  plan_required: 'statusPlan',
  verification_required: 'statusVerification'
});
// verification_required covers several server-side prerequisites; the heading and
// the next step follow the reason the server reported.
const VERIFICATION_KEYS = Object.freeze({
  authorization_consent_required: 'statusConsent',
  target_reverification_required: 'statusReverification',
  verification_scope_required: 'statusScope'
});
const KIND_KEYS = Object.freeze({
  full: 'kindFull', security: 'kindSecurity', seo: 'kindSeo', ai: 'kindAi', ai_visibility: 'kindAi',
  accessibility: 'kindAccessibility', performance: 'kindPerformance', integrations: 'kindIntegrations', 'search-console': 'kindSearchConsole'
});

export function statusHeading(model, t) {
  if (model.status === 'verification_required' && VERIFICATION_KEYS[model.reason]) return t(VERIFICATION_KEYS[model.reason]);
  return t(STATUS_KEYS[model.status] || 'statusBlocked');
}

// Why a blocked run produced no measurement. Server text (model.message) is shown
// separately by the caller, labelled as a message from the service.
export function problemText(model, t) {
  if (model.status !== 'blocked') return null;
  switch (model.reason) {
    // 0.1.0 stored a 403 as 'unauthorized'; it is not a rejected key either.
    case 'unauthorized': return model.httpStatus === 403 ? t('errorForbidden', [403]) : t('errorUnauthorized', [model.httpStatus ?? 401]);
    case 'forbidden': return t('errorForbidden', [model.httpStatus ?? 403]);
    case 'no_api_key': return t('errorNoApiKey');
    case 'interrupted': return t('errorInterrupted');
    case 'timeout': return model.jobId ? t('errorTimeoutJob', [model.jobId]) : t('errorTimeout');
    // A confirmed job survives a failed connection: the audit is still running on the
    // service, so the next step is to retrieve it, not to pay for a second one.
    case 'transport': return model.jobId
      ? t('errorTransportJob', [model.message || 'network', model.jobId])
      : t('errorTransport', [model.message || 'network']);
    case 'tool_error': return t('errorTool');
    case 'incomplete': return t('errorIncomplete');
    default: return null;
  }
}

// Status line of the options page "Test connection" for a failed initialize call.
export function connectionErrorText(error, t) {
  if (error instanceof McpHttpError && error.status === 401) return t('testUnauthorized', [401]);
  if (error instanceof McpHttpError && error.status === 403) {
    return error.serviceMessage ? t('testForbiddenMessage', [403, clip(error.serviceMessage, 300)]) : t('testForbidden', [403]);
  }
  return t('testFailed', [error?.message || String(error)]);
}

// Phase line of the running view. Always the extension's own text: the service's
// running answer is written for MCP clients (it explains how to poll) and never shown.
export function runningPhaseKey(job) {
  if (job?.busy) return 'busyPhase';
  return job?.jobId || job?.polls > 0 ? 'runningOnService' : 'runningStarting';
}

export const notMeasuredText = (entry, t) => t(entry.key, entry.subs);
export const severityLabel = (severity, t) => t(`severity_${severity}`);

export function kindLabel(id, t) {
  const key = KIND_KEYS[id];
  if (!key) return String(id);
  const text = t(key);
  return text === key ? String(id) : text;
}

export function verificationStep(model, t) {
  if (model.status === 'verification_required' && model.reason === 'authorization_consent_required') {
    return { text: t('stepAcceptTerms'), url: APP_URL, label: t('linkApp') };
  }
  if (model.status === 'verification_required' || model.notMeasured.some((entry) => entry.key === 'nmVerificationModules')) {
    return { text: t('stepVerifyOwnership'), url: APP_URL, label: t('linkApp') };
  }
  return null;
}

export function formatPrice(plan, t) {
  if (plan.monthly == null) return t('priceSeePricing');
  if (plan.monthly === 0) return t('priceFree');
  const amount = plan.currency === 'USD' ? `$${plan.monthly}` : `${plan.currency} ${plan.monthly}`;
  return t('priceMonthly', [amount]);
}

// Neutral plan and usage facts. Shown when a plan or quota gate stopped the audit,
// or when the connected account is on the Free plan. Facts come from /api/plans.
export function planSection(model, plans, t) {
  if (!['quota_exhausted', 'plan_required'].includes(model.status) && model.plan !== 'free') return null;
  const free = freePlan(plans);
  let intro;
  if (model.status === 'quota_exhausted') intro = t('planQuota');
  else if (model.status === 'plan_required') intro = t('planRequired', [kindLabel(model.kind, t)]);
  else intro = free && free.moduleCount != null && free.securityScans != null ? t('planFree', [free.moduleCount, free.securityScans]) : t('planFreeNoFacts');
  const remaining = model.remainingScans != null ? t('planRemaining', [model.remainingScans]) : null;
  const paid = paidPlans(plans).map((plan) => ({
    id: plan.id,
    line: t('planPaidLine', [
      plan.label,
      formatPrice(plan, t),
      plan.auditKinds.map((kind) => kindLabel(kind, t)).join(', ') || t('priceSeePricing'),
      plan.moduleCount ?? t('priceSeePricing'),
      plan.securityScans ?? t('priceSeePricing')
    ])
  }));
  return {
    title: t('planTitle'),
    intro,
    remaining,
    paidIntro: paid.length ? t('planPaidIntro') : null,
    paid,
    links: [
      { label: t('linkPricing'), url: PRICING_URL },
      { label: t('linkApp'), url: APP_URL }
    ]
  };
}

export function formatTimestamp(ms, locale) {
  try {
    return new Date(ms).toLocaleString(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ms).toISOString();
  }
}
