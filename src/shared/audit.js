// Start an audit and poll it to completion within a time budget. The loop is
// resumable: pass the stored pollArguments and jobId to continue a job that was
// started by an earlier service worker instance.
import { McpHttpError, McpRpcError } from './mcp-client.js';

export const AUDIT_TOOLS = Object.freeze({
  security: 'audit_security',
  seo: 'audit_seo',
  ai_visibility: 'audit_ai_visibility',
  integrations: 'audit_integrations',
  accessibility: 'audit_accessibility',
  performance: 'audit_performance',
  full: 'audit_full'
});
export const DEFAULT_KIND = 'security';
export const DEFAULT_DEADLINE_MS = 20 * 60_000;
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isTransientError(error) {
  if (error instanceof McpRpcError) return false;
  if (error instanceof McpHttpError) return error.status >= 500 || error.status === 408;
  return true; // DNS/network failures and request timeouts
}

// First text line of a tool result: the server says whether a job is queued or executing.
export function phaseLine(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content.find((c) => c?.type === 'text')?.text?.split('\n')[0]?.trim() || '';
}

// The server answers long audits with status "running", a jobId and pollArguments.
// Those arguments are re-sent unchanged to the same tool until the final result.
// onRunning(state) is awaited after every "running" answer, before the wait, so a
// caller can persist the state and schedule a wake-up (chrome.alarms).
export async function runAudit({
  client, tool, args, jobId = null, deadline, sleep = sleepFor,
  minWaitMs = 1000, maxWaitMs = 25_000, onRunning = async () => {}, onBusy = async () => {}, log = () => {}
}) {
  let current = args;
  const remaining = () => deadline - Date.now();
  const wait = async (ms) => {
    const delay = Math.min(Math.max(Number(ms) || 0, minWaitMs), maxWaitMs, Math.max(0, remaining()));
    if (delay > 0) await sleep(delay);
  };
  let polls = 0;
  let transient = 0;
  let busy = 0;
  let phase = '';
  for (;;) {
    if (remaining() <= 0) return { outcome: 'timeout', tool, jobId, polls, args: current };
    let result;
    try {
      result = await client.callTool(tool, current);
    } catch (error) {
      const rateLimited = error instanceof McpHttpError && error.status === 429 && error.code !== 'COMMERCIAL_USAGE_LIMIT_REACHED';
      if (rateLimited && busy++ < 40) {
        const delay = error.retryAfterMs ?? 5000;
        log(`Sitelemetry asked to retry later (${error.message}); waiting ${Math.ceil(delay / 1000)}s.`);
        await onBusy({ jobId, retryAfterMs: delay, message: error.message });
        await wait(delay);
        continue;
      }
      if (isTransientError(error) && transient++ < 3) {
        log(`Transient error (${error.message}); retrying.`);
        await wait(2000 * 2 ** transient);
        continue;
      }
      return { outcome: 'error', tool, error, jobId, polls, args: current };
    }
    const structured = result?.structuredContent;
    if (structured?.status === 'running' && typeof structured.jobId === 'string') {
      if (jobId !== structured.jobId) log(`Audit accepted as job ${structured.jobId}; polling until it completes.`);
      const line = phaseLine(result);
      if (line && line !== phase) { phase = line; log(`Sitelemetry: ${line}`); }
      jobId = structured.jobId;
      polls += 1;
      current = structured.pollArguments && typeof structured.pollArguments === 'object' ? structured.pollArguments : { ...current, jobId };
      const retryAfterMs = Number.isFinite(structured.retryAfterMs) ? structured.retryAfterMs : 2000;
      await onRunning({ jobId, pollArguments: current, retryAfterMs, phase: line, polls });
      await wait(retryAfterMs);
      continue;
    }
    if (structured?.status === 'action_required' && structured.reason === 'audit_job_busy' && busy++ < 10) {
      log('Another audit is already running for this account; retrying shortly.');
      await onBusy({ jobId, retryAfterMs: 15_000, message: phaseLine(result) });
      await wait(15_000);
      continue;
    }
    return { outcome: 'result', tool, result, jobId, polls, args: current };
  }
}
