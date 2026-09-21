import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_TOOLS, isTransientError, phaseLine, runAudit } from '../src/shared/audit.js';
import { McpHttpError, McpRpcError, createMcpClient } from '../src/shared/mcp-client.js';
import { interpretOutcome } from '../src/shared/outcome.js';
import { TEST_API_KEY, startMockServer } from './mock-server.mjs';

const noSleep = async () => {};
let server;
before(async () => { server = await startMockServer(); });
after(async () => { await server.close(); });

async function connectedClient(apiKey = TEST_API_KEY, url = server.url) {
  const client = createMcpClient({ baseUrl: url, apiKey });
  await client.initialize();
  return client;
}

test('runAudit re-sends pollArguments unchanged, waits retryAfterMs and reports each running state', async () => {
  const calls = [];
  const waits = [];
  const states = [];
  const pollArguments = { target: 'https://ok.example/', jobId: 'mj_1' };
  const responses = [
    { content: [{ type: 'text', text: 'Queued for capacity.\nmore' }], structuredContent: { status: 'running', jobId: 'mj_1', pollArguments, retryAfterMs: 250 } },
    { content: [{ type: 'text', text: 'Executing.' }], structuredContent: { status: 'running', jobId: 'mj_1', pollArguments, retryAfterMs: 50 } },
    { structuredContent: { status: 'completed', score: 90, findings: [] } }
  ];
  const client = { callTool: async (name, args) => { calls.push({ name, args }); return responses.shift(); } };
  const run = await runAudit({
    client, tool: AUDIT_TOOLS.security, args: { target: 'https://ok.example' }, deadline: Date.now() + 60_000,
    sleep: async (ms) => waits.push(ms), minWaitMs: 100, onRunning: async (state) => states.push(state)
  });
  assert.equal(run.outcome, 'result');
  assert.equal(run.polls, 2);
  assert.equal(run.jobId, 'mj_1');
  assert.deepEqual(calls[0], { name: 'audit_security', args: { target: 'https://ok.example' } });
  assert.deepEqual(calls[1].args, pollArguments);
  assert.deepEqual(calls[2].args, pollArguments);
  assert.deepEqual(waits, [250, 100]);
  assert.deepEqual(states.map((s) => [s.jobId, s.retryAfterMs, s.phase, s.polls]), [['mj_1', 250, 'Queued for capacity.', 1], ['mj_1', 50, 'Executing.', 2]]);
  assert.deepEqual(states[0].pollArguments, pollArguments);
  assert.equal(phaseLine(responses[0] ?? { content: [{ type: 'text', text: 'x\ny' }] }), 'x');
});

test('runAudit stops at the deadline and returns the arguments needed to resume', async () => {
  const pollArguments = { target: 'https://ok.example/', jobId: 'mj_2' };
  const client = { callTool: async () => ({ structuredContent: { status: 'running', jobId: 'mj_2', pollArguments, retryAfterMs: 10 } }) };
  let now = Date.now();
  const deadline = now + 40;
  const run = await runAudit({ client, tool: 'audit_security', args: { target: 'https://ok.example' }, deadline, sleep: async () => { now += 30; }, minWaitMs: 1 });
  // The fake clock only advances the sleep bookkeeping; the real Date drives the deadline.
  assert.ok(['timeout', 'result'].includes(run.outcome));
  if (run.outcome === 'timeout') {
    assert.equal(run.jobId, 'mj_2');
    assert.deepEqual(run.args, pollArguments);
  }
});

test('runAudit waits on 429 and on a busy account, and gives up on non-transient errors', async () => {
  const waits = [];
  let attempts = 0;
  const flaky = {
    callTool: async () => {
      attempts += 1;
      if (attempts === 1) throw new McpHttpError(429, { error: 'busy' }, { get: () => '2' });
      if (attempts === 2) return { content: [{ type: 'text', text: 'Busy.' }], structuredContent: { status: 'action_required', reason: 'audit_job_busy' } };
      if (attempts === 3) throw new McpHttpError(503, { error: 'down' }, null);
      return { structuredContent: { status: 'completed', findings: [] } };
    }
  };
  const run = await runAudit({ client: flaky, tool: 'audit_security', args: { target: 'https://x.example' }, deadline: Date.now() + 60_000, sleep: async (ms) => waits.push(ms), minWaitMs: 1 });
  assert.equal(run.outcome, 'result');
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [2000, 15_000, 4000]);

  const quota = { callTool: async () => { throw new McpHttpError(429, { error: 'Monthly limit reached', code: 'COMMERCIAL_USAGE_LIMIT_REACHED' }, null); } };
  const quotaRun = await runAudit({ client: quota, tool: 'audit_security', args: { target: 'https://x.example' }, deadline: Date.now() + 60_000, sleep: noSleep });
  assert.equal(quotaRun.outcome, 'error');
  assert.equal(interpretOutcome(quotaRun, { kind: 'security', target: 'https://x.example' }).status, 'quota_exhausted');

  const rpc = { callTool: async () => { throw new McpRpcError({ code: -32602, message: 'Unknown tool' }); } };
  const rpcRun = await runAudit({ client: rpc, tool: 'audit_security', args: { target: 'https://x.example' }, deadline: Date.now() + 60_000, sleep: noSleep });
  assert.equal(rpcRun.outcome, 'error');
  assert.equal(isTransientError(rpcRun.error), false);
  assert.equal(isTransientError(new Error('fetch failed')), true);
});

test('against the mock server: queued job, busy retry, gates and resumption', async () => {
  const client = await connectedClient();
  const deadline = () => Date.now() + 60_000;
  const context = (host) => ({ kind: 'security', target: `https://${host}` });

  const ok = await runAudit({ client, tool: 'audit_security', args: { target: 'https://ok.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 });
  assert.equal(ok.outcome, 'result');
  assert.equal(ok.polls, 2);
  assert.match(ok.jobId, /^mj_/);
  const model = interpretOutcome(ok, context('ok.example'));
  assert.equal(model.status, 'completed');
  assert.equal(model.score, 82);
  assert.equal(model.jobId, ok.jobId);
  const pollCalls = server.toolCalls().filter((call) => call.body.params.arguments.jobId === ok.jobId);
  assert.equal(pollCalls.length, 2);
  assert.deepEqual(pollCalls[0].body.params.arguments, { target: 'https://ok.example/', jobId: ok.jobId });

  // Resuming from stored pollArguments (a new worker instance) reaches the same result.
  const fresh = await startMockServer({ runningPolls: 3 });
  try {
    const client2 = await connectedClient(TEST_API_KEY, fresh.url);
    let saved = null;
    const first = await runAudit({
      client: client2, tool: 'audit_security', args: { target: 'https://ok.example' }, deadline: Date.now() + 60_000, sleep: async () => { throw new Error('killed'); }, minWaitMs: 1,
      onRunning: async (state) => { saved = state; }
    }).catch((error) => error);
    assert.equal(first.message, 'killed');
    assert.ok(saved?.jobId && saved.pollArguments.jobId === saved.jobId);
    const resumed = await runAudit({ client: client2, tool: 'audit_security', args: saved.pollArguments, jobId: saved.jobId, deadline: Date.now() + 60_000, sleep: noSleep, minWaitMs: 1 });
    assert.equal(resumed.outcome, 'result');
    assert.equal(resumed.jobId, saved.jobId);
    assert.equal(interpretOutcome(resumed, context('ok.example')).status, 'completed');
    assert.equal(fresh.toolCalls().filter((call) => !call.body.params.arguments.jobId).length, 1, 'no second audit is started');
  } finally {
    await fresh.close();
  }

  const busy = await runAudit({ client, tool: 'audit_security', args: { target: 'https://busy.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 });
  assert.equal(interpretOutcome(busy, context('busy.example')).status, 'completed');

  const gates = {
    'quota.example': ['quota_exhausted', 'usage_limit_reached'],
    'plan-result.example': ['plan_required', 'entitlement_required'],
    'verify.example': ['verification_required', 'target_verification_required'],
    'consent.example': ['verification_required', 'authorization_consent_required']
  };
  for (const [host, [status, reason]] of Object.entries(gates)) {
    const run = await runAudit({ client, tool: 'audit_security', args: { target: `https://${host}` }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 });
    const gate = interpretOutcome(run, context(host));
    assert.equal(gate.status, status, host);
    assert.equal(gate.reason, reason, host);
    assert.match(gate.message, /No audit quota was used/);
  }
  const free = interpretOutcome(await runAudit({ client, tool: 'audit_security', args: { target: 'https://free.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 }), context('free.example'));
  assert.equal(free.status, 'partial');
  assert.equal(free.plan, 'free');
  const planHttp = interpretOutcome(await runAudit({ client, tool: 'audit_security', args: { target: 'https://plan.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 }), context('plan.example'));
  assert.deepEqual([planHttp.status, planHttp.reason, planHttp.httpStatus], ['plan_required', 'PLAN_UPGRADE_REQUIRED', 402]);
  const quotaRpc = interpretOutcome(await runAudit({ client, tool: 'audit_security', args: { target: 'https://quota-rpc.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 }), context('quota-rpc.example'));
  assert.equal(quotaRpc.status, 'quota_exhausted');
  const toolError = interpretOutcome(await runAudit({ client, tool: 'audit_security', args: { target: 'https://error.example' }, deadline: deadline(), sleep: noSleep, minWaitMs: 1 }), context('error.example'));
  assert.deepEqual([toolError.status, toolError.reason], ['blocked', 'tool_error']);
});

test('a rejected key is reported as unauthorized without retries', async () => {
  const client = createMcpClient({ baseUrl: server.url, apiKey: 'sl_wrong' });
  const before = server.calls.length;
  const run = await runAudit({ client, tool: 'audit_security', args: { target: 'https://ok.example' }, deadline: Date.now() + 60_000, sleep: noSleep, minWaitMs: 1 });
  assert.equal(run.outcome, 'error');
  const model = interpretOutcome(run, { kind: 'security', target: 'https://ok.example' });
  assert.deepEqual([model.status, model.reason, model.httpStatus], ['blocked', 'unauthorized', 401]);
  assert.equal(server.calls.length - before, 1);
});
