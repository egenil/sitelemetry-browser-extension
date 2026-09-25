// Stub of the chrome.* APIs the popup and the options page use, for dev/harness.html
// only. Storage is in memory, tabs.query returns one fake tab, runtime.sendMessage
// simulates the service worker: a running job for a moment, then a result built from
// the test fixtures through the real outcome module. Never shipped.
(() => {
  const script = document.currentScript;
  const scenario = script?.dataset.scenario || 'completed';
  const root = new URL('../../', document.baseURI).href;
  const tabUrl = script?.dataset.url || (scenario === 'unsupported' ? 'chrome://extensions' : 'https://www.example.com/pricing');
  // The browser UI language, as chrome.i18n.getUILanguage() reports it (?lang=tr, pt-BR, zh-CN...).
  const uiLanguage = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(script?.dataset.lang || '') ? script.dataset.lang : 'en';

  // Messages, synchronously, so chrome.i18n.getMessage works from the first call.
  // Like Chrome: the exact locale, then the language alone, backed by the default
  // locale for any key the translation lacks.
  const loadMessages = (folder) => {
    const request = new XMLHttpRequest();
    request.open('GET', `${root}_locales/${folder}/messages.json`, false);
    request.send();
    return request.status === 200 ? JSON.parse(request.responseText) : null;
  };
  const exact = uiLanguage.replace('-', '_');
  const translated = exact === 'en' ? null : loadMessages(exact) || loadMessages(exact.split('_')[0]);
  const messages = { ...loadMessages('en'), ...(translated || {}) };
  const getMessage = (key, subs = []) => {
    const entry = messages[key];
    if (!entry) return '';
    const list = (Array.isArray(subs) ? subs : [subs]).map(String);
    const placeholders = Object.fromEntries(Object.entries(entry.placeholders || {}).map(([n, v]) => [n.toLowerCase(), v]));
    return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$/g, (m, name) => {
      if (m === '$$') return '$';
      const ph = placeholders[name.toLowerCase()];
      return ph ? String(ph.content).replace(/\$(\d)/g, (_, n) => list[Number(n) - 1] ?? '') : m;
    });
  };

  // In-memory chrome.storage.local with onChanged.
  const store = {};
  const listeners = [];
  if (!['nokey'].includes(scenario)) store.apiKey = 'sl_demo_key_not_real';
  if (!['nokey', 'notacked'].includes(scenario)) store.ownershipAcknowledgedAt = Date.now() - 86_400_000;
  const ready = (async () => {
    const plans = await import(`${root}src/shared/plans.js`);
    const catalogue = await (await fetch(`${root}test/fixtures/plans.json`)).json();
    store.plansCache = { fetchedAt: Date.now(), baseUrl: 'https://sitelemetry.com', plans: plans.normalizePlans(catalogue.plans) };
    // A job Sitelemetry is still running after the extension's time budget: the job
    // is kept with its pollArguments and the button offers to check it again.
    if (scenario === 'stalled') {
      const origin = new URL(tabUrl).origin;
      const { interpretOutcome } = await import(`${root}src/shared/outcome.js`);
      store.jobs = {
        [origin]: {
          origin, target: origin, kind: 'security', tool: 'audit_security', jobId: 'mj_demo',
          pollArguments: { target: `${origin}/`, jobId: 'mj_demo' }, dispatched: true, stalled: true, polls: 48,
          tabId: 1, startedAt: Date.now() - 1_200_000, updatedAt: Date.now(), deadline: Date.now() - 1000
        }
      };
      const model = interpretOutcome({ outcome: 'timeout', tool: 'audit_security', jobId: 'mj_demo' }, { kind: 'security', target: origin });
      store.results = { [origin]: { model, finishedAt: Date.now(), kind: 'security' } };
    }
  })();
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const local = {
    async get(keys) {
      await ready;
      const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const name of names) if (store[name] !== undefined) out[name] = clone(store[name]);
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: clone(store[key]), newValue: clone(value) };
        store[key] = clone(value);
      }
      setTimeout(() => { for (const fn of listeners) fn(changes, 'local'); }, 0);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    }
  };

  async function buildModel(origin, lang) {
    const { interpretOutcome } = await import(`${root}src/shared/outcome.js`);
    const { McpHttpError } = await import(`${root}src/shared/mcp-client.js`);
    const fixture = async (name) => (await fetch(`${root}test/fixtures/${name}`)).json();
    const gate = (reason, text) => ({ content: [{ type: 'text', text }], structuredContent: { status: 'action_required', reason, auditExecuted: false, usageConsumed: false } });
    const context = { kind: scenario === 'full' ? 'full' : 'security', target: origin };
    const tool = scenario === 'full' ? 'audit_full' : 'audit_security';
    switch (scenario) {
      case 'free': return interpretOutcome({ outcome: 'result', tool, jobId: 'mj_demo', result: await fixture('security-partial-free.json') }, context);
      case 'full': return interpretOutcome({ outcome: 'result', tool, jobId: 'mj_demo', result: await fixture('full-partial.json') }, context);
      // A site whose unknown paths redirect to its sign-in page (307, trailing-slash
      // paths 308) behind a firewall that drops probes to closed ports. The service
      // answers in the requested report language (English and Turkish fixtures).
      case 'redirects': return interpretOutcome({ outcome: 'result', tool, jobId: 'mj_demo', result: await fixture(lang === 'tr' ? 'security-partial-redirects-tr.json' : 'security-partial-redirects.json') }, context);
      case 'quota': return { ...interpretOutcome({ outcome: 'result', tool, result: gate('usage_limit_reached', 'Audit not started. No audit quota was used. The current audit allowance is exhausted. Retry after the allowance resets.') }, context), remainingScans: 0 };
      case 'plan': return interpretOutcome({ outcome: 'result', tool, result: gate('entitlement_required', 'Audit not started. No audit quota was used. The requested audit requires Starter or higher access and is not included in the connected Free account.') }, context);
      case 'verify': return interpretOutcome({ outcome: 'result', tool, result: gate('target_verification_required', 'Audit not started. No audit quota was used. Verify ownership of this target in Sitelemetry or Google Search Console before retrying. No plan change is required.') }, context);
      case 'consent': return interpretOutcome({ outcome: 'result', tool, result: gate('authorization_consent_required', 'Audit not started. No audit quota was used. Review and accept the current audit authorization terms in your account before retrying.') }, context);
      case 'unauthorized': return interpretOutcome({ outcome: 'error', tool, error: new McpHttpError(401, { error: 'Unauthorized. Provide a Sitelemetry MCP API key as a Bearer token.' }, null) }, context);
      case 'forbidden': return interpretOutcome({ outcome: 'error', tool, error: new McpHttpError(403, { error: 'This request is not allowed for the connected account.' }, null) }, context);
      case 'transport': return interpretOutcome({ outcome: 'error', tool, error: new TypeError('Failed to fetch') }, context);
      default: return interpretOutcome({ outcome: 'result', tool, jobId: 'mj_demo', result: await fixture('security-completed.json') }, context);
    }
  }

  const runtime = {
    async sendMessage(message) {
      if (message?.type !== 'audit:start') return { ok: true };
      const origin = message.origin;
      const now = Date.now();
      const lang = message.lang || 'en';
      const job = { origin, target: origin, kind: 'security', tool: 'audit_security', lang, jobId: null, pollArguments: null, polls: 0, busy: false, tabId: 1, startedAt: now, updatedAt: now, deadline: now + 1_200_000 };
      await local.set({ jobs: { [origin]: job } });
      setTimeout(() => local.set({ jobs: { [origin]: { ...job, jobId: 'mj_demo', polls: 1 } } }), 700);
      if (scenario !== 'running') {
        setTimeout(async () => {
          const model = await buildModel(origin, lang);
          await local.set({ jobs: {}, results: { [origin]: { model, finishedAt: Date.now(), kind: model.kind, lang } } });
        }, 2200);
      }
      return { ok: true, job };
    },
    connect: () => ({ postMessage() {}, onDisconnect: { addListener() {} }, onMessage: { addListener() {} } }),
    openOptionsPage: () => { window.top.location.search = `?page=options&lang=${encodeURIComponent(uiLanguage)}`; },
    onMessage: { addListener() {} },
    onConnect: { addListener() {} }
  };

  const noop = async () => {};
  window.chrome = {
    i18n: { getMessage, getUILanguage: () => uiLanguage },
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: { query: async () => [{ id: 1, url: tabUrl, active: true }] },
    runtime,
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setBadgeTextColor: noop },
    alarms: { create: noop, clear: noop, onAlarm: { addListener() {} } }
  };
})();
