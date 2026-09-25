import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTranslator } from '../src/shared/i18n.js';
import { McpHttpError, McpRpcError } from '../src/shared/mcp-client.js';
import { SEVERITIES, blockedOutcome, countBySeverity, interpretOutcome, isMeasured, normalizeFinding, notMeasuredEntries, shortHash, sortBySeverity } from '../src/shared/outcome.js';
import { normalizePlans } from '../src/shared/plans.js';
import { APP_URL, PRICING_URL } from '../src/shared/links.js';
import { connectionErrorText, formatPrice, kindLabel, notMeasuredText, planSection, problemText, runningPhaseKey, statusHeading, verificationStep } from '../src/shared/text.js';
import { fixture } from './mock-server.mjs';

const messages = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const t = createTranslator(messages);
const context = { kind: 'security', target: 'https://ok.example' };
const completed = () => interpretOutcome({ outcome: 'result', tool: 'audit_security', result: fixture('security-completed.json') }, context);
const free = () => interpretOutcome({ outcome: 'result', tool: 'audit_security', result: fixture('security-partial-free.json') }, { kind: 'security', target: 'https://free.example' });
const plans = normalizePlans(fixture('plans.json').plans);
const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });

test('interpretOutcome maps transport, plan, quota and verification outcomes to statuses', () => {
  const timeout = interpretOutcome({ outcome: 'timeout', tool: 'audit_security', jobId: 'mj_x' }, context);
  assert.deepEqual([timeout.status, timeout.reason, timeout.jobId], ['blocked', 'timeout', 'mj_x']);
  const unauthorized = interpretOutcome({ outcome: 'error', error: new McpHttpError(401, { error: 'Unauthorized.' }, headers({})) }, context);
  assert.deepEqual([unauthorized.status, unauthorized.reason, unauthorized.httpStatus, unauthorized.message], ['blocked', 'unauthorized', 401, 'Unauthorized.']);
  const unauthorizedPage = interpretOutcome({ outcome: 'error', error: new McpHttpError(401, { error: '<html>Sign in</html>' }, headers({}), { json: false }) }, context);
  assert.deepEqual([unauthorizedPage.reason, unauthorizedPage.message], ['unauthorized', ''], 'a proxy page answering 401 is not shown as a message from Sitelemetry');
  const forbidden = interpretOutcome({ outcome: 'error', error: new McpHttpError(403, { error: 'Forbidden.' }, headers({})) }, context);
  assert.deepEqual([forbidden.status, forbidden.reason, forbidden.httpStatus, forbidden.message], ['blocked', 'forbidden', 403, 'Forbidden.']);
  const forbiddenPage = interpretOutcome({ outcome: 'error', error: new McpHttpError(403, { error: '<html>Access denied</html>' }, headers({}), { json: false }) }, context);
  assert.deepEqual([forbiddenPage.reason, forbiddenPage.message], ['forbidden', ''], 'a non-JSON body is not attributed to the service');
  const forbiddenEmpty = interpretOutcome({ outcome: 'error', error: new McpHttpError(403, {}, headers({})) }, context);
  assert.equal(forbiddenEmpty.message, '', 'no invented message for an empty body');
  const paymentRequired = interpretOutcome({ outcome: 'error', error: new McpHttpError(402, { error: 'This feature is not included in Free.', code: 'PLAN_UPGRADE_REQUIRED' }, headers({})) }, context);
  assert.deepEqual([paymentRequired.status, paymentRequired.reason], ['plan_required', 'PLAN_UPGRADE_REQUIRED']);
  const quotaHttp = interpretOutcome({ outcome: 'error', error: new McpHttpError(429, { error: 'Monthly security scan limit reached for this account (monthly allowance: 10).', code: 'COMMERCIAL_USAGE_LIMIT_REACHED' }, headers({ 'retry-after': '60' })) }, context);
  assert.equal(quotaHttp.status, 'quota_exhausted');
  const quotaRpc = interpretOutcome({ outcome: 'error', error: new McpRpcError({ code: -32603, message: 'Monthly security scan limit reached for this account (monthly allowance: 10).' }) }, context);
  assert.equal(quotaRpc.status, 'quota_exhausted');
  const planRpc = interpretOutcome({ outcome: 'error', error: new McpRpcError({ code: -32603, message: 'The requested audit requires Starter or higher access and is not included in the connected Free account.' }) }, context);
  assert.equal(planRpc.status, 'plan_required');
  const transport = interpretOutcome({ outcome: 'error', error: new TypeError('Failed to fetch') }, context);
  assert.deepEqual([transport.status, transport.reason, transport.message], ['blocked', 'transport', 'Failed to fetch']);
  const gate = (reason) => interpretOutcome({ outcome: 'result', result: { content: [{ type: 'text', text: 'Audit not started.' }], structuredContent: { status: 'action_required', reason, auditExecuted: false, usageConsumed: false } } }, context).status;
  assert.equal(gate('entitlement_required'), 'plan_required');
  assert.equal(gate('usage_limit_reached'), 'quota_exhausted');
  assert.equal(gate('target_verification_required'), 'verification_required');
  assert.equal(gate('authorization_consent_required'), 'verification_required');
  assert.equal(gate('audit_job_unavailable'), 'blocked');
  const toolError = interpretOutcome({ outcome: 'result', result: { isError: true, content: [{ type: 'text', text: 'Error: audit failed' }] } }, context);
  assert.deepEqual([toolError.status, toolError.reason], ['blocked', 'tool_error']);
  const running = interpretOutcome({ outcome: 'result', result: { structuredContent: { status: 'running', jobId: 'mj_1' } } }, context);
  assert.deepEqual([running.status, running.reason], ['blocked', 'incomplete']);
});

test('interpretOutcome normalizes completed, partial and full results', () => {
  const model = completed();
  assert.equal(model.status, 'completed');
  assert.ok(isMeasured(model));
  assert.deepEqual([model.score, model.grade, model.total, model.plan, model.passingChecks], [82, 'B', 4, 'starter', 12]);
  assert.deepEqual(model.counts, { critical: 0, high: 1, medium: 1, low: 1, info: 1 });
  assert.equal(model.findings[0].fix, 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains on every HTTPS response.');
  assert.equal(model.findings[2].location, '/robots.txt');
  assert.equal(model.findings[0].id.startsWith('sf2:'), true);
  assert.deepEqual(model.notMeasured, []);
  assert.deepEqual(sortBySeverity([{ severity: 'low' }, { severity: 'critical' }, { severity: 'high' }]).map((f) => f.severity), ['critical', 'high', 'low']);
  assert.deepEqual(countBySeverity([{ severity: 'high' }, { severity: 'high' }]), { critical: 0, high: 2, medium: 0, low: 0, info: 0 });

  const partial = free();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.plan, 'free');
  assert.deepEqual(partial.notMeasured, [
    { key: 'nmVerificationModules', subs: ['http-methods, exposure, api-exposure'] },
    { key: 'nmModuleStatusReasons', subs: ['rdap', 'unavailable', 'registry_timeout'] }
  ]);
  assert.equal(notMeasuredText(partial.notMeasured[0], t), 'Security modules that require ownership verification of the site: http-methods, exposure, api-exposure');
  assert.equal(notMeasuredText(partial.notMeasured[1], t), 'Module rdap: unavailable (registry_timeout)');

  const full = interpretOutcome({ outcome: 'result', tool: 'audit_full', result: fixture('full-partial.json') }, { kind: 'full', target: 'https://full.example' });
  assert.equal(full.status, 'partial');
  assert.equal(full.score, 71);
  assert.deepEqual(Object.keys(full.pillars), ['Security', 'SEO']);
  assert.deepEqual(full.notMeasured, [{ key: 'nmPillarFailed', subs: ['Performance', 'PageSpeed Insights was unavailable for this target.'] }]);
  assert.equal(full.findings[0].pillar, 'Security');
  assert.equal(full.plan, 'professional');

  const unmeasured = notMeasuredEntries({
    failedPillars: [],
    auditDetails: {
      pillars: {
        Security: { scope: { status: 'partial', plan: 'enterprise', moduleResults: [{ module: 'tls', status: 'unavailable', reasons: ['The TLS certificate check requires an https:// target.'] }, { module: 'ports', status: 'partial' }] } },
        Performance: { scope: { status: 'unavailable', method: 'lighthouse_crux' } }
      },
      planCoverage: { plan: 'enterprise', skippedPillars: [{ pillar: 'SEO', reason: 'not_in_plan' }, { pillar: 'AI', reason: 'scope' }], skippedSecurityModules: ['wordpress'] }
    }
  });
  assert.deepEqual(unmeasured.map((entry) => notMeasuredText(entry, t)), [
    'SEO: not included in the connected plan',
    'AI: outside the connected account scope',
    'Security modules outside the connected plan: wordpress',
    'Performance: unavailable (no measurement for this site)',
    'Module tls: unavailable (The TLS certificate check requires an https:// target.)',
    'Module ports: partial'
  ]);
});

test('normalizeFinding clips text, defaults the severity and derives a stable id', () => {
  const finding = normalizeFinding({ title: 'x'.repeat(300), severity: 'bogus', remediation: 'fix it', url: 'https://a.example/p' }, 3);
  assert.equal(finding.severity, 'info');
  assert.equal(finding.title.length, 200);
  assert.equal(finding.fix, 'fix it');
  assert.equal(finding.location, 'https://a.example/p');
  assert.equal(finding.id, `finding-3-${shortHash(finding.title)}`);
  assert.equal(shortHash('abc'), shortHash('abc'));
  assert.notEqual(shortHash('abc'), shortHash('abd'));
  assert.equal(normalizeFinding({}).title, 'Untitled finding');
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low', 'info']);
});

test('headings, next steps and problem text come from the message table', () => {
  const model = completed();
  assert.equal(statusHeading(model, t), 'Completed');
  assert.equal(statusHeading({ ...model, status: 'partial' }, t), 'Completed with partial coverage');
  assert.equal(statusHeading({ ...model, status: 'quota_exhausted' }, t), 'Not run: the monthly audit allowance of the connected account is used up');
  assert.equal(statusHeading({ ...model, status: 'verification_required', reason: 'target_verification_required' }, t), 'Not run: ownership verification of the site is required');
  assert.equal(statusHeading({ ...model, status: 'verification_required', reason: 'authorization_consent_required' }, t), 'Not run: the connected account must accept the current audit authorization terms');
  assert.equal(statusHeading({ ...model, status: 'verification_required', reason: 'target_reverification_required' }, t), 'Not run: ownership verification of the site must be renewed');
  assert.equal(statusHeading({ ...model, status: 'verification_required', reason: 'verification_scope_required' }, t), 'Not run: the current verification of the site does not cover the requested host-level checks');

  assert.equal(verificationStep(model, t), null);
  const verify = verificationStep({ ...model, status: 'verification_required', reason: 'target_verification_required' }, t);
  assert.equal(verify.url, APP_URL);
  assert.match(verify.text, /Verify ownership of this site in the app/);
  const consent = verificationStep({ ...model, status: 'verification_required', reason: 'authorization_consent_required' }, t);
  assert.match(consent.text, /accept the current audit authorization terms/);
  assert.match(verificationStep(free(), t).text, /Verify ownership/);

  assert.equal(problemText(model, t), null);
  assert.equal(problemText({ ...model, status: 'blocked', reason: 'unauthorized', httpStatus: 401 }, t), 'Sitelemetry rejected the API key (HTTP 401). Check the key in the extension settings.');
  const refused = problemText({ ...model, status: 'blocked', reason: 'forbidden', httpStatus: 403 }, t);
  assert.equal(refused, 'Sitelemetry refused this request (HTTP 403).');
  assert.doesNotMatch(refused, /API key|rejected/, 'a 403 is not described as a rejected key');
  // 0.1.0 stored a 403 as reason 'unauthorized'; results kept from that version read the same way.
  assert.equal(problemText({ ...model, status: 'blocked', reason: 'unauthorized', httpStatus: 403 }, t), 'Sitelemetry refused this request (HTTP 403).');
  assert.match(problemText({ ...model, status: 'blocked', reason: 'timeout', jobId: 'mj_9' }, t), /job mj_9/);
  assert.match(problemText({ ...model, status: 'blocked', reason: 'timeout', jobId: 'mj_9' }, t), /Check again/, 'the deadline text offers to retrieve the job');
  assert.match(problemText({ ...model, status: 'blocked', reason: 'timeout', jobId: null }, t), /did not finish/);
  assert.equal(problemText({ ...model, status: 'blocked', reason: 'transport', message: 'Failed to fetch' }, t), 'Sitelemetry could not be reached: Failed to fetch');
  const droppedWithJob = problemText({ ...model, status: 'blocked', reason: 'transport', message: 'Failed to fetch', jobId: 'mj_7' }, t);
  assert.match(droppedWithJob, /Failed to fetch/);
  assert.match(droppedWithJob, /job mj_7/, 'a confirmed job is named so it can be retrieved');
  assert.match(droppedWithJob, /Check again/, 'the network failure text offers to retrieve the job');
  assert.match(droppedWithJob, /no allowance is used again/, 'and says so without pressing for a new scan');
  assert.equal(problemText({ ...model, status: 'blocked', reason: 'tool_error' }, t), 'The audit tool returned an error.');
  assert.equal(problemText({ ...model, status: 'blocked', reason: 'rpc_-32602', message: 'Unknown tool' }, t), null);

  // Problems the extension detects itself carry no service text and no HTTP status.
  const noKey = blockedOutcome({ kind: 'security', target: 'https://ok.example', tool: 'audit_security', reason: 'no_api_key' });
  assert.deepEqual([noKey.status, noKey.message, noKey.httpStatus, noKey.jobId, noKey.score], ['blocked', '', null, null, null]);
  assert.match(problemText(noKey, t), /^No Sitelemetry API key is stored on this device/);
  assert.doesNotMatch(problemText(noKey, t), /HTTP/, 'a missing key is not reported as a rejected one');
  assert.match(problemText({ ...noKey, reason: 'interrupted' }, t), /before Sitelemetry confirmed a job/);
  assert.equal(problemText({ ...noKey, status: 'completed' }, t), null);
});

test('the plan box is neutral, factual and only shown for Free accounts or gates', () => {
  assert.equal(planSection(completed(), plans, t), null, 'a paid plan gets no plan box');
  const box = planSection(free(), plans, t);
  assert.equal(box.title, 'Plan and usage');
  assert.equal(box.intro, 'The connected account is on the Free plan: 10 public security modules and 10 security scans per month.');
  assert.equal(box.remaining, null);
  assert.equal(box.paid.length, 3);
  assert.equal(box.paid[0].line, 'Starter ($49/month): Full, Security, SEO, AI visibility, Accessibility, Performance, Integrations, Search Console; 13 security modules; 100 security scans per month.');
  assert.match(box.paid[2].line, /^Enterprise \(\$249\/month\).*27 security modules; 25000 security scans per month\.$/);
  assert.deepEqual(box.links.map((l) => l.url), [PRICING_URL, APP_URL]);
  assert.equal(PRICING_URL, 'https://sitelemetry.com/pricing?utm_source=browser-extension&utm_medium=extension');

  const quota = planSection({ ...completed(), status: 'quota_exhausted', remainingScans: 0 }, plans, t);
  assert.match(quota.intro, /used its monthly audit allowance/);
  assert.equal(quota.remaining, 'Remaining security scans in the current period: 0.');
  const plan = planSection({ ...completed(), status: 'plan_required' }, null, t);
  assert.equal(plan.intro, "The Security audit is not included in the connected account's plan. No audit was started and no allowance was used.");
  assert.equal(plan.paidIntro, null);
  const noFacts = planSection(free(), null, t);
  assert.equal(noFacts.intro, 'The connected account is on the Free plan.');

  assert.equal(formatPrice({ monthly: 0 }, t), 'Free');
  assert.equal(formatPrice({ monthly: null }, t), 'see pricing');
  assert.equal(formatPrice({ monthly: 12, currency: 'EUR' }, t), 'EUR 12/month');
  assert.equal(kindLabel('search-console', t), 'Search Console');
  assert.equal(kindLabel('unknown-kind', t), 'unknown-kind');

  const allText = Object.values(messages).map((entry) => entry.message).join('\n');
  assert.doesNotMatch(allText, /upgrade now|limited time|don't miss|hurry|act now|only today/i, 'no pressure language');
});

test('the options connection test tells a rejected key from a refused request', () => {
  assert.equal(connectionErrorText(new McpHttpError(401, { error: 'Unauthorized.' }, headers({})), t), 'The API key was rejected (HTTP 401).');
  const refused = connectionErrorText(new McpHttpError(403, { error: 'Not allowed for this account.' }, headers({})), t);
  assert.equal(refused, 'Sitelemetry refused this request (HTTP 403). Message from Sitelemetry: Not allowed for this account.');
  assert.doesNotMatch(refused, /API key was rejected/);
  assert.equal(connectionErrorText(new McpHttpError(403, { error: '<html>blocked</html>' }, headers({}), { json: false }), t), 'Sitelemetry refused this request (HTTP 403).');
  assert.equal(connectionErrorText(new McpHttpError(403, {}, headers({})), t), 'Sitelemetry refused this request (HTTP 403).');
  assert.equal(connectionErrorText(new McpHttpError(500, { error: 'Server error' }, headers({})), t), 'Connection failed: Server error');
  assert.equal(connectionErrorText(new TypeError('Failed to fetch'), t), 'Connection failed: Failed to fetch');
});

test('the running view only shows the extension phase text, never the service text', () => {
  assert.equal(runningPhaseKey({ jobId: null, polls: 0, busy: false }), 'runningStarting');
  assert.equal(runningPhaseKey({ jobId: 'mj_1', polls: 1, busy: false }), 'runningOnService');
  assert.equal(runningPhaseKey({ jobId: 'mj_1', polls: 3, busy: true }), 'busyPhase');
  // A job stored by 0.1.0 may still carry the service's model-facing text; it is ignored.
  const legacy = { jobId: 'mj_1', polls: 2, phase: 'The audit is still running. Call the same tool with the returned pollArguments unchanged.' };
  assert.equal(t(runningPhaseKey(legacy)), 'The audit is running on Sitelemetry. Results appear here automatically.');
  const phases = ['runningStarting', 'runningOnService', 'busyPhase'].map((key) => t(key)).join('\n');
  assert.doesNotMatch(phases, /pollArguments|same tool|jobId/);
});
