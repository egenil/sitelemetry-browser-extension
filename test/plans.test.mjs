import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS_CACHE_MS, fetchPlans, freePlan, loadPlans, normalizePlans, paidPlans } from '../src/shared/plans.js';
import { fixture, startMockServer } from './mock-server.mjs';

let server;
before(async () => { server = await startMockServer(); });
after(async () => { await server.close(); });

test('normalizePlans keeps the facts the plan box needs', () => {
  const plans = normalizePlans(fixture('plans.json').plans);
  assert.equal(plans.length, 4);
  assert.deepEqual(plans[0], { id: 'free', label: 'Free', monthly: 0, currency: 'USD', auditKinds: ['security'], moduleCount: 10, securityScans: 10 });
  assert.equal(plans[1].securityScans, 100);
  assert.equal(normalizePlans(null), null);
  assert.equal(normalizePlans([{ nope: true }]), null);
  assert.equal(normalizePlans([{ id: 'x', modules: ['a', 'b'] }])[0].moduleCount, 2);
  assert.equal(freePlan(plans).id, 'free');
  assert.deepEqual(paidPlans(plans).map((p) => p.id), ['starter', 'professional', 'enterprise']);
  assert.equal(freePlan(null), null);
});

test('fetchPlans reads /api/plans and returns null on failure', async () => {
  const plans = await fetchPlans(server.url);
  assert.equal(plans.length, 4);
  assert.equal(await fetchPlans('http://127.0.0.1:1'), null);
  assert.equal(await fetchPlans(server.url, async () => ({ ok: false, json: async () => ({}) })), null);
});

test('loadPlans serves a fresh cache and refreshes a stale or foreign one', async () => {
  const persisted = [];
  const persist = async (entry) => persisted.push(entry);
  const plans = normalizePlans(fixture('plans.json').plans);
  const fresh = { fetchedAt: Date.now(), baseUrl: server.url, plans };
  assert.equal(await loadPlans({ baseUrl: server.url, cache: fresh, persist, fetchImpl: async () => { throw new Error('must not fetch'); } }), plans);
  assert.equal(persisted.length, 0);
  const stale = { fetchedAt: Date.now() - PLANS_CACHE_MS - 1, baseUrl: server.url, plans: [] };
  const refreshed = await loadPlans({ baseUrl: server.url, cache: stale, persist });
  assert.equal(refreshed.length, 4);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].baseUrl, server.url);
  const other = await loadPlans({ baseUrl: 'http://127.0.0.1:1', cache: { fetchedAt: Date.now(), baseUrl: 'http://elsewhere', plans }, persist });
  assert.equal(other, plans, 'an unreachable catalogue falls back to whatever was cached');
  assert.equal(await loadPlans({ baseUrl: 'http://127.0.0.1:1', cache: null, persist }), null);
});
