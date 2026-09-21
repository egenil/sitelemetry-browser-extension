// Public plan catalogue (GET /api/plans) used for the neutral plan/usage box.
export const PLANS_CACHE_MS = 24 * 60 * 60_000;

export function normalizePlans(list) {
  if (!Array.isArray(list)) return null;
  const plans = list
    .filter((plan) => plan && typeof plan === 'object' && typeof plan.id === 'string')
    .map((plan) => ({
      id: plan.id,
      label: typeof plan.label === 'string' ? plan.label : plan.id,
      monthly: Number.isFinite(plan.price?.monthly) ? plan.price.monthly : null,
      currency: typeof plan.price?.currency === 'string' ? plan.price.currency : 'USD',
      auditKinds: Array.isArray(plan.auditKinds) ? plan.auditKinds.map(String) : [],
      moduleCount: Number.isFinite(plan.moduleCount) ? plan.moduleCount : Array.isArray(plan.modules) ? plan.modules.length : null,
      securityScans: Number.isFinite(plan.commercial?.securityScans) ? plan.commercial.securityScans : null
    }));
  return plans.length ? plans : null;
}

export async function fetchPlans(baseUrl, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/api/plans`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    return normalizePlans((await response.json())?.plans);
  } catch {
    return null;
  }
}

// Cached wrapper: `cache` is { fetchedAt, baseUrl, plans } or null and `persist`
// stores a fresh entry. Returns plans, or null when the catalogue is unreachable
// and nothing is cached.
export async function loadPlans({ baseUrl, cache, persist, now = Date.now(), fetchImpl }) {
  if (cache && cache.baseUrl === baseUrl && Array.isArray(cache.plans) && now - cache.fetchedAt < PLANS_CACHE_MS) return cache.plans;
  const plans = await fetchPlans(baseUrl, fetchImpl);
  if (plans && persist) await persist({ fetchedAt: now, baseUrl, plans });
  return plans ?? cache?.plans ?? null;
}

export const freePlan = (plans) => plans?.find((plan) => plan.id === 'free') || null;
export const paidPlans = (plans) => (plans || []).filter((plan) => plan.id !== 'free');
