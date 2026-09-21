// Popup: "Audit this site" for the active tab, the stored result for its origin and
// the running-job view. All network work happens in the service worker; the popup
// reads chrome.storage.local and re-renders when it changes.
import { applyBadge } from '../shared/badge.js';
import { localizeDocument, t } from '../shared/i18n.js';
import { SIGNUP_URL } from '../shared/links.js';
import { SEVERITIES, isMeasured, sortBySeverity } from '../shared/outcome.js';
import { freePlan, loadPlans } from '../shared/plans.js';
import { getJob, getPlansCache, getResult, getSettings, originOf, saveSettings, setPlansCache } from '../shared/storage.js';
import { formatTimestamp, notMeasuredText, planSection, problemText, severityLabel, statusHeading, verificationStep } from '../shared/text.js';

const MAX_FINDINGS = 10;
const state = { tab: null, origin: null, settings: null, job: null, result: null, plans: null, error: null, busy: false };
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}
const link = (label, url, className = null) => el('a', { href: url, target: '_blank', rel: 'noopener', class: className, text: label });
const scoreClass = (score) => (score == null ? 'none' : score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor');

function renderFinding(finding) {
  const details = el('details', { class: 'finding' });
  details.append(el('summary', {}, [
    el('span', { class: `chip sev ${finding.severity}`, text: severityLabel(finding.severity, t) }),
    el('span', { class: 'title', text: finding.title })
  ]));
  const list = el('dl');
  const row = (labelKey, value, className = null) => {
    if (!value) return;
    list.append(el('dt', { text: t(labelKey) }), el('dd', { class: className, text: value }));
  };
  row('locationLabel', finding.location);
  row('evidenceLabel', finding.evidence);
  row('impactLabel', finding.impact);
  row('fixLabel', finding.fix, 'fix');
  details.append(el('div', { class: 'finding-body' }, [list]));
  return details;
}

function renderResult(entry) {
  const { model } = entry;
  const card = el('section', { class: 'card result' });
  card.append(el('div', { class: 'status-row' }, [
    el('h2', { text: statusHeading(model, t) }),
    el('span', { class: 'timestamp', text: formatTimestamp(entry.finishedAt) })
  ]));

  if (isMeasured(model)) {
    const ring = el('div', { class: `score-ring ${scoreClass(model.score)}` }, [
      el('span', { class: 'score-value', text: model.score == null ? t('scoreNotMeasured') : String(model.score) })
    ]);
    ring.style.setProperty('--score', String(model.score ?? 0));
    const meta = el('div', { class: 'score-meta' });
    if (model.grade) meta.append(el('p', { class: 'grade', text: t('gradeLabel', [model.grade]) }));
    meta.append(el('p', { class: 'small', text: t('findingsSummary', [model.total]) }));
    if (model.passingChecks) meta.append(el('p', { class: 'small muted', text: t('passingChecks', [model.passingChecks]) }));
    const chips = el('div', { class: 'chips' });
    for (const severity of SEVERITIES) {
      if (model.counts[severity] > 0) chips.append(el('span', { class: `chip ${severity}`, text: `${model.counts[severity]} ${severityLabel(severity, t)}` }));
    }
    if (chips.childElementCount) meta.append(chips);
    card.append(el('div', { class: 'score-block' }, [ring, meta]));

    if (model.pillars) {
      const table = el('table', { class: 'pillars' });
      for (const [name, pillar] of Object.entries(model.pillars)) {
        table.append(el('tr', {}, [el('td', { text: name }), el('td', { text: pillar?.score ?? '-' }), el('td', { text: String(pillar?.findings ?? 0) })]));
      }
      card.append(table);
    }

    const top = sortBySeverity(model.findings).slice(0, MAX_FINDINGS);
    if (top.length) {
      card.append(el('h3', { class: 'section-title', text: t('topFindingsTitle') }));
      for (const finding of top) card.append(renderFinding(finding));
      if (model.total > top.length) card.append(el('p', { class: 'small muted', text: t('moreFindings', [model.total - top.length]) }));
    } else {
      card.append(el('p', { text: t('noFindings') }));
    }

    if (model.status === 'partial') {
      card.append(el('h3', { class: 'section-title', text: t('notMeasuredTitle') }));
      card.append(el('p', { class: 'small muted', text: t('notMeasuredNote') }));
      const list = el('ul', { class: 'small' });
      for (const item of model.notMeasured) list.append(el('li', { text: notMeasuredText(item, t) }));
      if (!model.notMeasured.length) list.append(el('li', { text: t('nmUnknown') }));
      card.append(list);
    }
  } else {
    const problem = problemText(model, t);
    if (problem) card.append(el('p', { text: problem }));
    if (model.message) {
      card.append(el('p', { class: 'small muted', text: t('serverMessageLabel') }));
      card.append(el('div', { class: 'quote small', text: model.message }));
    }
  }

  const links = el('div', { class: 'links' });
  if (model.reportUrl) links.append(link(t('openReport'), model.reportUrl));
  const step = verificationStep(model, t);
  if (step) {
    card.append(el('p', { class: 'small', text: step.text }));
    links.append(link(step.label, step.url));
  }
  if (links.childElementCount) card.append(links);

  const plan = planSection(model, state.plans, t);
  if (plan) {
    const box = el('div', { class: 'plan-box small' });
    box.append(el('h3', { text: plan.title }));
    box.append(el('p', { text: plan.intro }));
    if (plan.remaining) box.append(el('p', { text: plan.remaining }));
    if (plan.paidIntro) {
      box.append(el('p', { text: plan.paidIntro }));
      const list = el('ul');
      for (const row of plan.paid) list.append(el('li', { text: row.line }));
      box.append(list);
    }
    box.append(el('div', { class: 'links' }, plan.links.map((row) => link(row.label, row.url))));
    card.append(box);
  }
  return card;
}

function render() {
  const { origin, settings, job, result } = state;
  const hasKey = Boolean(settings?.apiKey);
  const acknowledged = Boolean(settings?.acknowledgedAt);
  $('site').textContent = origin || (state.tab?.url ? state.tab.url.slice(0, 80) : '');
  $('view-unsupported').hidden = Boolean(origin);
  $('view-setup').hidden = !origin || hasKey;
  $('view-notice').hidden = !origin || !hasKey || acknowledged;
  // A stalled job (the deadline passed while Sitelemetry kept running it) is not a
  // running audit: the button offers to check it again, which polls the same job
  // instead of starting - and paying for - a second one.
  const running = Boolean(job) && !job.stalled;
  $('view-running').hidden = !running;
  $('view-result').hidden = !result || running;
  const audit = $('audit');
  audit.hidden = !origin || !hasKey;
  audit.textContent = job?.stalled ? t('checkAgainButton') : result ? t('auditAgainButton') : t('auditButton');
  audit.disabled = running || state.busy || (!acknowledged && !$('ack').checked);

  if (running) {
    $('running-phase').textContent = job.busy ? t('busyPhase') : job.phase || t('runningStarting');
    $('running-job').textContent = job.jobId ? t('jobLabel', [job.jobId]) : '';
  }
  const resultView = $('view-result');
  resultView.replaceChildren();
  if (result && !running) resultView.append(renderResult(result));

  const free = freePlan(state.plans);
  $('setup-facts').textContent = free && free.securityScans != null ? t('noAccountHint', [free.securityScans]) : t('noAccountHintNoFacts');

  const error = $('error');
  error.hidden = !state.error;
  error.textContent = state.error ? t(`startError_${state.error}`) : '';
}

async function refresh() {
  state.settings = await getSettings();
  if (state.origin) {
    state.job = await getJob(state.origin);
    state.result = await getResult(state.origin);
  }
  render();
}

async function loadPlanFacts() {
  try {
    state.plans = await loadPlans({ baseUrl: state.settings.baseUrl, cache: await getPlansCache(), persist: setPlansCache });
  } catch {
    state.plans = null;
  }
  render();
}

async function startAudit() {
  if (!state.origin || state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    if (!state.settings.acknowledgedAt) {
      if (!$('ack').checked) return;
      await saveSettings({ acknowledgedAt: Date.now() });
    }
    const response = await chrome.runtime.sendMessage({ type: 'audit:start', origin: state.origin, tabId: state.tab?.id, kind: 'security' });
    if (!response?.ok) state.error = response?.error || 'unknown';
  } catch (error) {
    state.error = 'unknown';
    console.warn('Could not start the audit:', error?.message || error);
  } finally {
    state.busy = false;
    await refresh();
  }
}

async function main() {
  localizeDocument();
  document.title = t('popupTitle');
  $('signup-link').href = SIGNUP_URL;
  $('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('setup-open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('ack').addEventListener('change', render);
  $('audit').addEventListener('click', startAudit);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  state.origin = originOf(tab?.url);
  await refresh();
  if (state.origin && typeof tab?.id === 'number') applyBadge(tab.id, state.result, Boolean(state.job) && !state.job.stalled);
  loadPlanFacts();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.jobs || changes.results || changes.apiKey || changes.ownershipAcknowledgedAt || changes.baseUrl) refresh();
  });

  // Pinging the worker over a port keeps it alive while the popup shows a running audit.
  try {
    const port = chrome.runtime.connect({ name: 'popup' });
    const timer = setInterval(() => { try { port.postMessage({ type: 'ping' }); } catch { clearInterval(timer); } }, 20_000);
    port.onDisconnect.addListener(() => clearInterval(timer));
  } catch {
    // The worker may be restarting; the alarm still resumes the job.
  }
}

main().catch((error) => {
  $('error').hidden = false;
  $('error').textContent = t('startError_unknown');
  console.warn('Popup failed to initialize:', error?.message || error);
});
