// Background service worker: starts audits, polls running jobs and keeps the
// toolbar badge current. A job survives the popup closing and the worker being
// suspended: its state is persisted after every poll and a chrome.alarms wake-up
// resumes it from the stored pollArguments.
import { AUDIT_TOOLS, DEFAULT_DEADLINE_MS, DEFAULT_KIND, isTransientError, runAudit } from '../shared/audit.js';
import { applyBadge } from '../shared/badge.js';
import { createMcpClient } from '../shared/mcp-client.js';
import { blockedOutcome, interpretOutcome } from '../shared/outcome.js';
import { getJob, getJobs, getResult, getSettings, originOf, setJob, setResult } from '../shared/storage.js';

const ALARM_PREFIX = 'sitelemetry-poll:';
// Chrome enforces a 30 second minimum for packed extensions.
const ALARM_DELAY_MINUTES = 0.5;
const driving = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alarmName = (origin) => `${ALARM_PREFIX}${origin}`;

async function wakeLater(origin) {
  await chrome.alarms.create(alarmName(origin), { delayInMinutes: ALARM_DELAY_MINUTES });
}

// The badge states a score for the audited site, so it may only be painted on a tab
// that still shows that site: an audit runs for minutes, Chrome clears the badge
// when the tab navigates, and re-applying it blindly would claim a score for
// whatever page the tab shows now. Without the "tabs" permission tab.url is
// undefined once the activeTab grant has lapsed, which degrades to no badge.
async function badgeForJob(job, entry, running = false) {
  if (typeof job?.tabId !== 'number') return;
  let tab = null;
  try { tab = await chrome.tabs.get(job.tabId); } catch { return; }
  if (originOf(tab?.url) !== job.origin) return;
  await applyBadge(job.tabId, entry, running);
}

// A terminal outcome: the result is kept for the site and the job is done.
async function finish(origin, job, model) {
  await setResult(origin, { model, finishedAt: Date.now(), kind: job.kind });
  await setJob(origin, null);
  await chrome.alarms.clear(alarmName(origin));
  await badgeForJob(job, { model }, false);
}

// The run ended without a result while Sitelemetry still had the job: the deadline
// passed, or the connection failed and the retries ran out. The job keeps its jobId
// and pollArguments, so the popup can offer to check again: polling retrieves that
// same audit, while starting a new one would use another scan.
async function stall(origin, job, model) {
  await setResult(origin, { model, finishedAt: Date.now(), kind: job.kind });
  await setJob(origin, { ...job, stalled: true, updatedAt: Date.now() });
  await chrome.alarms.clear(alarmName(origin));
  await badgeForJob(job, { model }, false);
}

// Run or resume the job stored for an origin until it ends or the deadline passes.
async function drive(origin) {
  // A wake-up that arrives while a request is in flight would otherwise be spent for
  // nothing: alarms are one-shot and only a "running" answer re-arms one, so the job
  // would stop waking the worker until that call returns - and the worker can be torn
  // down while it is still pending. Re-arm before leaving; chrome.alarms.create
  // replaces an alarm of the same name, so the running loop's own wake-up overwrites
  // this one and the job is never driven twice.
  if (driving.has(origin)) {
    await wakeLater(origin);
    return;
  }
  driving.add(origin);
  try {
    const job = await getJob(origin);
    // A stalled job is only resumed when the user asks for it (see startAudit).
    if (!job || job.stalled) return;
    const context = { kind: job.kind, target: job.target };
    const problem = (reason) => blockedOutcome({ ...context, tool: job.tool, jobId: job.jobId, reason });
    const settings = await getSettings();
    // Nothing was sent: this is a missing key, not a key the service rejected.
    if (!settings.apiKey) {
      await finish(origin, job, problem('no_api_key'));
      return;
    }
    // The call that starts the audit is the one that uses a scan of the allowance.
    // If the worker was stopped while it was in flight, the job has neither a jobId
    // nor pollArguments to retrieve it with, and re-sending the start call would run
    // a second audit for the same click.
    if (job.dispatched && !job.pollArguments && !job.jobId) {
      await finish(origin, job, problem('interrupted'));
      return;
    }
    const state = { ...job };
    const persist = async (patch) => {
      Object.assign(state, patch, { updatedAt: Date.now() });
      await setJob(origin, state);
      await wakeLater(origin);
    };
    const client = createMcpClient({ baseUrl: settings.baseUrl, apiKey: settings.apiKey });
    let run;
    try {
      await client.initialize();
      // Record the start call before it goes out, so that a worker restart can tell
      // it apart from a job that never reached the service.
      if (!state.pollArguments && !state.jobId) await persist({ dispatched: true });
      run = await runAudit({
        client,
        tool: job.tool,
        args: state.pollArguments || { target: job.target },
        jobId: state.jobId,
        deadline: job.deadline,
        sleep,
        onRunning: (update) => persist({ jobId: update.jobId, pollArguments: update.pollArguments, retryAfterMs: update.retryAfterMs, polls: update.polls, busy: false }),
        onBusy: () => persist({ busy: true })
      });
    } catch (error) {
      run = { outcome: 'error', error, tool: job.tool, jobId: state.jobId };
    }
    const model = interpretOutcome(run, context);
    // Once Sitelemetry has confirmed a job it is running the audit and has reserved a
    // scan for it, and the stored arguments are the only way back to that result.
    // Whether the run gave up on the clock or on the connection, the job is kept for
    // "Check again" rather than discarded, which would cost a second scan to redo.
    const retrievable = Boolean(state.jobId || state.pollArguments);
    const recoverable = run.outcome === 'timeout' || (run.outcome === 'error' && isTransientError(run.error));
    if (retrievable && recoverable) await stall(origin, state, model);
    else await finish(origin, state, model);
  } catch (error) {
    console.warn('Sitelemetry audit could not be driven:', error?.message || error);
  } finally {
    driving.delete(origin);
  }
}

async function resumeJobs() {
  const jobs = await getJobs();
  for (const [origin, job] of Object.entries(jobs)) if (!job?.stalled) drive(origin);
}

async function startAudit({ origin, tabId, kind = DEFAULT_KIND }) {
  const target = originOf(origin);
  if (!target) return { ok: false, error: 'unsupported_origin' };
  const tool = AUDIT_TOOLS[kind];
  if (!tool) return { ok: false, error: 'unsupported_kind' };
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, error: 'no_api_key' };
  if (!settings.acknowledgedAt) return { ok: false, error: 'not_acknowledged' };
  const existing = await getJob(target);
  if (existing && !existing.stalled) return { ok: true, job: existing, existing: true };
  const now = Date.now();
  const tab = typeof tabId === 'number' ? tabId : null;
  // A stalled job is resumed, never restarted: its stored pollArguments retrieve the
  // audit Sitelemetry is already running instead of paying a scan for a new one.
  const job = existing
    ? { ...existing, stalled: false, busy: false, tabId: tab ?? existing.tabId, updatedAt: now, deadline: now + DEFAULT_DEADLINE_MS }
    : {
      origin: target, target, kind, tool, jobId: null, pollArguments: null, retryAfterMs: null, polls: 0,
      busy: false, dispatched: false, tabId: tab, startedAt: now, updatedAt: now, deadline: now + DEFAULT_DEADLINE_MS
    };
  await setJob(target, job);
  // The wake-up is scheduled before the first call so a job cannot be orphaned by a
  // worker restart; the dispatched flag keeps that resume from running it again.
  await wakeLater(target);
  await applyBadge(job.tabId, null, true);
  drive(target);
  return { ok: true, job, resumed: Boolean(existing) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'audit:start') {
    startAudit(message).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'ping') {
    sendResponse({ ok: true });
  }
  return false;
});

// The popup keeps a port open and pings it, which resets the worker's idle timer
// while the user is looking at a running audit.
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((message) => {
    if (message?.type === 'ping') port.postMessage({ type: 'pong' });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) drive(alarm.name.slice(ALARM_PREFIX.length));
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  resumeJobs();
});

chrome.runtime.onStartup.addListener(() => { resumeJobs(); });

// Best effort: without the "tabs" permission the URL is only visible for tabs where
// the user has invoked the extension (activeTab), so this mostly re-applies a badge
// after a same-site navigation in such a tab.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  const origin = originOf(tab.url);
  if (!origin) return;
  try {
    const job = await getJob(origin);
    if (job && !job.stalled) await applyBadge(tabId, null, true);
    else await applyBadge(tabId, await getResult(origin));
  } catch {
    // Storage may be unavailable during shutdown; the badge is cosmetic.
  }
});

resumeJobs();
