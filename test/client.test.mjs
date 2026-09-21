import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_INFO, McpHttpError, McpRpcError, createMcpClient, mcpEndpoint, parseRetryAfter, parseSse, selectResponse } from '../src/shared/mcp-client.js';
import { TEST_API_KEY, startMockServer } from './mock-server.mjs';

let server;
before(async () => { server = await startMockServer(); });
after(async () => { await server.close(); });

test('SSE bodies and JSON-RPC batches resolve to the matching response', () => {
  const body = ': keep-alive\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\nevent: message\ndata: not-json\n\n';
  const messages = parseSse(body);
  assert.equal(messages.length, 1);
  assert.deepEqual(selectResponse(messages, 7).result, { ok: true });
  assert.equal(selectResponse([{ jsonrpc: '2.0', id: 1, result: 'a' }, { jsonrpc: '2.0', id: 2, result: 'b' }], 2).result, 'b');
  assert.equal(selectResponse([[{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }]], 3).error.code, -32700);
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(mcpEndpoint('https://sitelemetry.com/'), 'https://sitelemetry.com/mcp');
});

test('initialize sends the bearer key, the client info and the protocol headers', async () => {
  const client = createMcpClient({ baseUrl: server.url, apiKey: TEST_API_KEY });
  const result = await client.initialize();
  assert.equal(result.serverInfo.name, 'mock-sitelemetry');
  assert.equal(result.protocolVersion, '2025-06-18');
  const init = server.calls.find((call) => call.path === '/mcp' && call.body?.method === 'initialize');
  assert.equal(init.headers.authorization, `Bearer ${TEST_API_KEY}`);
  assert.equal(init.headers['mcp-protocol-version'], '2025-06-18');
  assert.match(init.headers.accept, /text\/event-stream/);
  assert.deepEqual(init.body.params.clientInfo, { name: 'sitelemetry-browser-extension', version: CLIENT_INFO.version });
  assert.equal(JSON.stringify(init.body).includes(TEST_API_KEY), false, 'the key travels only in the header');
  const notified = server.calls.find((call) => call.body?.method === 'notifications/initialized');
  assert.ok(notified, 'the initialized notification is sent');
  const tools = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === 'audit_security'));
});

test('tools/call returns JSON and SSE results and surfaces HTTP and RPC errors', async () => {
  const client = createMcpClient({ baseUrl: server.url, apiKey: TEST_API_KEY });
  await client.initialize();
  const sync = await client.callTool('audit_security', { target: 'https://sync.example' });
  assert.equal(sync.structuredContent.status, 'completed');
  const sse = await client.callTool('audit_security', { target: 'https://sse.example' });
  assert.equal(sse.structuredContent.score, 82);
  await assert.rejects(client.callTool('audit_pentest', { target: 'https://sync.example' }), (error) => error instanceof McpRpcError && error.code === -32602);

  const wrongKey = createMcpClient({ baseUrl: server.url, apiKey: 'sl_wrong' });
  await assert.rejects(wrongKey.initialize(), (error) => error instanceof McpHttpError && error.status === 401 && /Unauthorized/.test(error.message));
  const plan = await client.callTool('audit_security', { target: 'https://plan.example' }).catch((error) => error);
  assert.ok(plan instanceof McpHttpError);
  assert.equal(plan.status, 402);
  assert.equal(plan.code, 'PLAN_UPGRADE_REQUIRED');
});

test('a 429 answer carries retry-after', async () => {
  const busy = await startMockServer();
  try {
    const client = createMcpClient({ baseUrl: busy.url, apiKey: TEST_API_KEY });
    const error = await client.callTool('audit_security', { target: 'https://busy.example' }).catch((e) => e);
    assert.ok(error instanceof McpHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 0);
  } finally {
    await busy.close();
  }
});
