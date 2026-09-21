// The audit driver of the background service worker, against the mock service and a
// minimal stub of the chrome.* APIs it uses. Every case loads a fresh module
// instance, because the worker registers its listeners and resumes the stored jobs
// at load time, exactly as Chrome starts it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TEST_API_KEY, startMockServer } from './mock-server.mjs';

let server;
before(async () => { server = await startMockServer(); });
after(async () => { await server.close(); });

let loads = 0;
const loadWorker = () => import(`../src/background/service-worker.js?case=${++loads}`);

function stubChrome(initial = {}) {
  const store = structuredClone(initial);
  const alarms = new Map();
  const badges = [];
  const tabs = new Map();
  const handlers = { message: [], alarm: [], updated: [] };
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const name of names) if (store[name] !== undefined) out[name] = clone(store[name]);
          return out;
        },
        async set(items) { for (const [key, value] of Object.entries(items)) store[key] = clone(value); }
      },
      onChanged: { addListener() {} }
    },
    alarms: {
      async create(name, info) { alarms.set(name, info); },
      async clear(name) { return alarms.delete(name); },
      onAlarm: { addListener: (fn) => handlers.alarm.push(fn) }
    },
    action: {
      async setBadgeText(details) { badges.push(details); },
      async setBadgeBackgroundColor() {},
      async setBadgeTextColor() {}
    },
    tabs: {
      // Like Chrome without the "tabs" permission: the tab is there, its URL is only
      // readable while the activeTab grant lasts (a tab missing here stands for both).
      async get(id) {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return tab;
      },
      onUpdated: { addListener: (fn) => handlers.updated.push(fn) }
    },
    runtime: {
      onMessage: { addListener: (fn) => handlers.message.push(fn) },
      onConnect: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      openOptionsPage() {}
    }
  };
  return { store, alarms, badges, tabs, handlers };
}

const connected = (extra = {}) => ({ apiKey: TEST_API_KEY, baseUrl: server.url, ownershipAcknowledgedAt: Date.now() - 1000, ...extra });
const storedJob = (target, extra = {}) => ({
  origin: target, target, kind: 'security', tool: 'audit_security', jobId: null, pollArguments: null, retryAfterMs: null,
  phase: '', polls: 0, busy: false, dispatched: false, tabId: null,
  startedAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000, deadline: Date.now() + 600_000, ...extra
});
const sendStart = (chrome, message) => new Promise((resolve) => chrome.handlers.message[0]({ type: 'audit:start', ...message }, null, resolve));
const dispatches = () => server.toolCalls().filter((call) => !call.body.params.arguments.jobId).length;

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('a finished audit is stored for the site and badges the tab that still shows it', async () => {
  const target = 'https://sync.example';
  const chrome = stubChrome(connected());
  chrome.tabs.set(7, { id: 7, url: 'https://sync.example/pricing' });
  await loadWorker();

  const response = await sendStart(chrome, { origin: target, tabId: 7 });
  assert.equal(response.ok, true);
  assert.equal(response.job.dispatched, false);
  await waitFor(() => chrome.badges.some((badge) => badge.text === '82'), 'the score badge');
  const entry = chrome.store.results[target];
  assert.deepEqual([entry.model.status, entry.model.score, entry.kind], ['completed', 82, 'security']);
  assert.deepEqual(chrome.badges.map((badge) => [badge.tabId, badge.text]), [[7, '…'], [7, '82']]);
  assert.deepEqual(chrome.store.jobs, {});
  assert.equal(chrome.alarms.size, 0, 'the wake-up alarm is cleared with the job');
});

test('a score is never badged onto a tab that has navigated away from the audited site', async () => {
  const moved = 'https://sync.example';
  const unseen = 'https://free.example';
  const chrome = stubChrome(connected({
    jobs: { [moved]: storedJob(moved, { tabId: 7 }), [unseen]: storedJob(unseen, { tabId: 9 }) }
  }));
  // Tab 7 has moved on while the audit ran; tab 9 no longer exposes its URL at all.
  chrome.tabs.set(7, { id: 7, url: 'https://news.example/latest' });
  await loadWorker();

  await waitFor(() => chrome.store.results?.[moved] && chrome.store.results?.[unseen], 'both results');
  await waitFor(() => !chrome.store.jobs?.[moved] && !chrome.store.jobs?.[unseen], 'both jobs to be cleared');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(chrome.store.results[moved].model.score, 82, 'the result itself is stored as usual');
  assert.deepEqual(chrome.badges, [], 'no badge is applied to a tab showing another site');
});

test('a job interrupted before the service confirmed it is never dispatched twice', async () => {
  const target = 'https://sync.example';
  const chrome = stubChrome(connected({ jobs: { [target]: storedJob(target, { dispatched: true }) } }));
  const before = dispatches();
  await loadWorker();

  const entry = await waitFor(() => chrome.store.results?.[target], 'the stored result');
  assert.deepEqual([entry.model.status, entry.model.reason, entry.model.message], ['blocked', 'interrupted', '']);
  assert.equal(dispatches(), before, 'the start call is not sent a second time');
  await waitFor(() => !chrome.store.jobs?.[target], 'the cleared job');
});

test('a missing API key is reported as a missing key, without inventing a rejection', async () => {
  const target = 'https://sync.example';
  const chrome = stubChrome({ baseUrl: server.url, jobs: { [target]: storedJob(target) } });
  const before = server.calls.length;
  await loadWorker();

  const entry = await waitFor(() => chrome.store.results?.[target], 'the stored result');
  assert.deepEqual([entry.model.status, entry.model.reason], ['blocked', 'no_api_key']);
  assert.equal(entry.model.httpStatus, null, 'no HTTP status is claimed');
  assert.equal(entry.model.message, '', 'no text is attributed to the service');
  assert.equal(server.calls.length, before, 'nothing is sent');
});

test('a job that outlives the deadline keeps its poll arguments and is resumed without a new scan', async () => {
  const target = 'https://ok.example';
  const pollArguments = { target: 'https://ok.example/', jobId: 'mj_seeded' };
  const chrome = stubChrome(connected({
    jobs: { [target]: storedJob(target, { jobId: 'mj_seeded', pollArguments, dispatched: true, polls: 3, deadline: Date.now() - 1 }) }
  }));
  const before = dispatches();
  await loadWorker();

  const stalled = await waitFor(() => (chrome.store.jobs?.[target]?.stalled ? chrome.store.jobs[target] : null), 'the stalled job');
  assert.deepEqual(stalled.pollArguments, pollArguments, 'the audit can still be retrieved');
  assert.equal(stalled.jobId, 'mj_seeded');
  assert.equal(chrome.store.results[target].model.reason, 'timeout');
  assert.equal(chrome.alarms.size, 0, 'a stalled job stops waking the worker');

  // "Check again" in the popup resumes that job; it must not start another audit.
  const response = await sendStart(chrome, { origin: target, tabId: 3 });
  assert.deepEqual([response.ok, response.resumed, response.job.stalled], [true, true, false]);
  assert.ok(response.job.deadline > Date.now(), 'the deadline is extended for the new attempt');
  const entry = await waitFor(() => (chrome.store.results?.[target]?.model.reason !== 'timeout' ? chrome.store.results[target] : null), 'the resumed result');
  assert.equal(entry.model.reason, 'audit_job_argument_mismatch', 'the seeded job id is answered by the service');
  assert.ok(server.toolCalls().some((call) => call.body.params.arguments.jobId === 'mj_seeded'), 'the stored poll arguments are re-sent');
  assert.equal(dispatches(), before, 'resuming retrieves the audit instead of starting another one');
});

// A dropped connection is not a reason to pay for a second audit: Sitelemetry is
// still running - and still charging for - the job the extension already has.
test('a network failure while a job is running keeps it retrievable instead of costing a second scan', async () => {
  const target = 'https://ok.example';
  const pollArguments = { target: 'https://ok.example/', jobId: 'mj_offline' };
  // Nothing listens on port 1, so every call fails the way a dropped connection does.
  const chrome = stubChrome({
    apiKey: TEST_API_KEY, baseUrl: 'http://127.0.0.1:1', ownershipAcknowledgedAt: Date.now() - 1000,
    jobs: { [target]: storedJob(target, { jobId: 'mj_offline', pollArguments, dispatched: true, polls: 2 }) }
  });
  const before = dispatches();
  await loadWorker();

  const kept = await waitFor(() => (chrome.store.jobs?.[target]?.stalled ? chrome.store.jobs[target] : null), 'the kept job');
  assert.deepEqual(kept.pollArguments, pollArguments, 'the audit can still be retrieved');
  assert.equal(kept.jobId, 'mj_offline');
  const model = chrome.store.results[target].model;
  assert.deepEqual([model.status, model.reason, model.jobId], ['blocked', 'transport', 'mj_offline'],
    'the failure names the job, so the popup can offer Check again');
  assert.equal(dispatches(), before, 'no replacement audit is started');
});

// Alarms created with delayInMinutes are one-shot: firing consumes them. Only a
// "running" answer re-arms one, so a wake-up delivered mid-call must not be dropped.
test('a wake-up that arrives while a request is in flight keeps the job waking the worker', async () => {
  const target = 'https://ok.example';
  const held = [];
  const stallingServer = http.createServer((req, res) => { held.push(res); });
  await new Promise((resolve) => stallingServer.listen(0, '127.0.0.1', resolve));
  const chrome = stubChrome({
    apiKey: TEST_API_KEY, baseUrl: `http://127.0.0.1:${stallingServer.address().port}`, ownershipAcknowledgedAt: Date.now() - 1000,
    jobs: { [target]: storedJob(target, { jobId: 'mj_held', pollArguments: { target: 'https://ok.example/', jobId: 'mj_held' }, dispatched: true, polls: 1 }) }
  });
  try {
    await loadWorker();
    await waitFor(() => held.length > 0, 'the in-flight request');
    assert.equal(chrome.alarms.size, 0, 'the resumed job has not armed a wake-up of its own yet');
    // Chrome delivers the pending wake-up and removes it while the call is still out.
    chrome.handlers.alarm[0]({ name: `sitelemetry-poll:${target}` });
    await waitFor(() => chrome.alarms.has(`sitelemetry-poll:${target}`), 'the re-armed wake-up');
  } finally {
    // Always let the pending call fail and release the server, so that a failing
    // assertion reports instead of holding the test run open on a live socket.
    for (const response of held) response.destroy();
    await waitFor(() => chrome.store.jobs?.[target]?.stalled, 'the kept job').catch(() => {});
    await new Promise((resolve) => stallingServer.close(resolve));
  }
});
