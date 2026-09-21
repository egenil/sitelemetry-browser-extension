import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeColor, badgeFor } from '../src/shared/badge.js';
import { DEFAULT_BASE_URL, SIGNUP_URL } from '../src/shared/links.js';
import { MAX_RESULTS, normalizeBaseUrl, originOf, pruneResults } from '../src/shared/storage.js';

test('originOf accepts only http(s) pages and returns the origin', () => {
  assert.equal(originOf('https://www.example.com/path?q=1#x'), 'https://www.example.com');
  assert.equal(originOf('http://localhost:8080/admin'), 'http://localhost:8080');
  assert.equal(originOf('chrome://extensions'), null);
  assert.equal(originOf('edge://settings'), null);
  assert.equal(originOf('file:///C:/x.html'), null);
  assert.equal(originOf('about:blank'), null);
  assert.equal(originOf(undefined), null);
  assert.equal(originOf('not a url'), null);
});

test('normalizeBaseUrl keeps https origins only', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl('  https://staging.sitelemetry.com/mcp/  '), 'https://staging.sitelemetry.com');
  assert.equal(normalizeBaseUrl('https://sitelemetry.com'), 'https://sitelemetry.com');
  assert.throws(() => normalizeBaseUrl('http://sitelemetry.com'), /scheme/);
  assert.throws(() => normalizeBaseUrl('sitelemetry.com'), /invalid/);
  assert.equal(SIGNUP_URL, 'https://sitelemetry.com/app?utm_source=browser-extension&utm_medium=extension');
});

test('pruneResults keeps the newest entries', () => {
  const results = {};
  for (let i = 0; i < MAX_RESULTS + 5; i += 1) results[`https://site${i}.example`] = { finishedAt: i };
  const pruned = pruneResults(results);
  assert.equal(Object.keys(pruned).length, MAX_RESULTS);
  assert.equal('https://site0.example' in pruned, false);
  assert.equal(`https://site${MAX_RESULTS + 4}.example` in pruned, true);
});

test('badge text is the score for measured results only', () => {
  assert.deepEqual(badgeFor(null), { text: '', color: '#6B7280' });
  assert.deepEqual(badgeFor(null, true), { text: '\u2026', color: '#6B7280' });
  assert.deepEqual(badgeFor({ model: { status: 'completed', score: 82 } }), { text: '82', color: badgeColor(82) });
  assert.equal(badgeFor({ model: { status: 'partial', score: 55.6 } }).text, '56');
  assert.equal(badgeFor({ model: { status: 'quota_exhausted', score: null } }).text, '');
  assert.equal(badgeFor({ model: { status: 'blocked', score: 90 } }).text, '');
  assert.equal(badgeColor(90), '#15803D');
  assert.equal(badgeColor(65), '#B45309');
  assert.equal(badgeColor(10), '#B91C1C');
});
