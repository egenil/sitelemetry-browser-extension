// The "Passing checks" section of a result: the checks that passed, grouped by
// security module in the order sitelemetry.com lists the modules. Pure functions
// over the stored entries (outcome.js keeps them with the result); the titles and
// evidence are the service's own text, in the report language it was asked for.
// Results stored by 0.1.2 have no list, only the service's count.
import { MODULE_IDS, moduleLabel } from './not-measured.js';

// Check id prefixes (after "ok.") of each module, as the service names its checks
// ("ok.tls.protocol.modern", "ok.exposure.env", "ok.http.cors.no-reflection"...).
// The first match wins, so a more specific prefix comes before a shorter one.
const ID_PREFIXES = Object.freeze([
  ['dns.email.', 'dns-email'], ['dns.caa', 'dns-email'], ['dns.', 'dns'],
  ['rdap.', 'rdap'],
  ['tls.', 'tls'],
  ['http.methods.', 'http-methods'], ['http.trace.', 'http-methods'], ['http.cors.credentials-', 'http-methods'],
  ['http.cors.origin-', 'http-methods'], ['http.cors.no-reflection', 'http-methods'],
  ['http.header.', 'http-headers'], ['http.cookie.', 'http-headers'], ['http.cors.wildcard', 'http-headers'], ['http.cors.no-wildcard', 'http-headers'],
  ['mitm.', 'mitm-posture'],
  ['tech.', 'tech-fingerprint'],
  ['exposure.', 'exposure'],
  ['api.', 'api-exposure'],
  ['auth.', 'auth-surface'],
  ['supply-chain.', 'supply-chain'],
  ['wordpress.', 'wordpress'], ['wp.', 'wordpress'],
  ['port.intel.', 'port-intel'], ['port-intel.', 'port-intel'], ['ports.', 'ports'], ['port.', 'ports'],
  ['sqli.', 'sql-injection'],
  ['resilience.', 'ddos-resilience'],
  ['secret-exposure.', 'secret-exposure'], ['secret.', 'secret-exposure'],
  ['subdomain-takeover.', 'subdomain-takeover'], ['subdomain.', 'subdomain-takeover'],
  ['cors-audit.', 'cors-audit'], ['cors.', 'cors-audit'],
  ['injection-canary.', 'injection-canary'], ['injection.', 'injection-canary'],
  ['transport-delivery.', 'transport-delivery'], ['delivery.', 'transport-delivery'],
  ['pentest.', 'pentest-suite']
]);

// The module of a check id, or null when the id belongs to no known module.
export function checkModule(id) {
  const name = String(id ?? '').replace(/^ok\./, '');
  const engine = /^engine\.([a-z0-9-]+)\./.exec(name);
  if (engine) return MODULE_IDS.includes(`engine-${engine[1]}`) ? `engine-${engine[1]}` : null;
  return ID_PREFIXES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null;
}

// { title, groups, note } for the popup, or null when the result has no passing
// check. The heading counts the checks listed; when the service counted more than
// the extension kept, it gives both numbers ("Passing checks (300 of 342)", so it
// never contradicts the count under the score) and the note, shown first, says how
// many were not kept. No report elsewhere holds them: the service keeps none for
// these audits. A result without a list (stored by 0.1.2, or sent without the
// checks) shows the service's count and a note instead of groups.
export function passingSection(model, t) {
  const stored = Array.isArray(model.passingItems) ? model.passingItems : null;
  const listed = stored ? stored.length : 0;
  const total = typeof model.passingChecks === 'number' && model.passingChecks > 0 ? model.passingChecks : 0;
  if (!listed && !total) return null;
  const heading = (title, count) => t('sectionCount', [title, count]);
  if (!listed) return { title: heading(t('passingTitle'), total), groups: [], note: t(stored ? 'passingNotListed' : 'passingLegacy') };
  const more = total > listed;

  const groups = new Map();
  for (const item of stored) {
    const module = checkModule(item?.id);
    if (!groups.has(module)) groups.set(module, []);
    groups.get(module).push({ title: item?.title || item?.id || '', evidence: item?.evidence || null });
  }
  const rank = (module) => (module == null ? MODULE_IDS.length : MODULE_IDS.indexOf(module));
  return {
    title: more ? t('sectionCountOfTotal', [t('passingTitle'), listed, total]) : heading(t('passingTitle'), listed),
    groups: [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([module, items]) => ({
      module,
      title: heading(module == null ? t('passingOther') : moduleLabel(module, t), items.length),
      items
    })),
    note: more ? t('passingMore', [total - listed]) : null
  };
}
