// The passing checks of a result: what outcome.js keeps with the stored result and
// the "Passing checks" section the popup builds from it (src/shared/passing.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFixPrompt } from '../src/shared/fix-prompt.js';
import { createTranslator } from '../src/shared/i18n.js';
import { MAX_PASSING_CHARS, MAX_PASSING_ITEMS, blockedOutcome, interpretOutcome, passingEntries } from '../src/shared/outcome.js';
import { checkModule, passingSection } from '../src/shared/passing.js';
import { fixture } from './mock-server.mjs';
import { REPORT_OR_APP } from './report-words.mjs';

const load = (folder) => JSON.parse(readFileSync(new URL(`../_locales/${folder}/messages.json`, import.meta.url), 'utf8'));
const en = load('en');
const t = createTranslator(en);
const NBSP = ' ';
const interpret = (result, target = 'https://ok.example') => interpretOutcome({ outcome: 'result', tool: 'audit_security', result }, { kind: 'security', target });
const withChecks = (items, extra = {}) => ({ structuredContent: { status: 'completed', score: 90, grade: 'A', total: 0, findings: [], auditDetails: { checks: { items } }, ...extra } });
const okItem = (id, title = `Title of ${id}`, evidence = '', location = '') => ({ id, status: 'ok', title, evidence, location });

test('the passing checks of a result are kept with it: id, title and evidence, in the service order', () => {
  const completed = interpret(fixture('security-completed.json'));
  assert.equal(completed.passingItems.length, 12);
  assert.equal(completed.passingChecks, 12, 'the fixture lists every check it counts');
  assert.ok(fixture('security-completed.json').structuredContent.auditDetails.checks.items[0].location, 'the service sends a location too');
  assert.deepEqual(completed.passingItems[0], { id: 'ok.dns.resolve', title: 'DNS resolution successful', evidence: '198.51.100.7' }, 'the location is not kept: the popup does not show it');
  assert.deepEqual(completed.passingItems.at(-1), { id: 'ok.exposure.wp-config-php-bak', title: '/wp-config.php.bak is not accessible', evidence: 'HTTP 404; path not found' });

  const redirects = interpret(fixture('security-partial-redirects.json'), 'https://redirects.example');
  const raw = fixture('security-partial-redirects.json').structuredContent.auditDetails.checks.items;
  assert.equal(redirects.passingItems.length, 29);
  assert.equal(redirects.passingChecks, 29);
  assert.deepEqual(redirects.passingItems.map((item) => item.id), raw.filter((item) => item.status === 'ok').map((item) => item.id), 'only the ok items, in order');
  assert.ok(raw.some((item) => item.status === 'skipped'), 'the fixture has skipped checks, which are not kept');

  const turkish = interpret(fixture('security-partial-redirects-tr.json'), 'https://redirects.example');
  assert.equal(turkish.passingItems[0].title, 'DNS çözümü başarılı', 'titles stay in the report language the service used');
});

test('only checks with status ok are kept, clipped and capped so the stored result stays small', () => {
  const statuses = ['ok', 'skipped', 'observed', 'not_applicable', 'manual_review', 'fail', 'error', 'pass', 'OK', undefined];
  const mixed = interpret(withChecks([
    ...statuses.map((status, index) => ({ id: `ok.dns.check-${index}`, status, title: `Check ${index}`, evidence: 'e', location: 'https://ok.example/' })),
    null, 'ok', 42, { status: 'ok' }, { status: 'ok', id: '', title: '' }, { status: 'ok', title: 'Title only' }
  ]));
  assert.deepEqual(mixed.passingItems, [
    { id: 'ok.dns.check-0', title: 'Check 0', evidence: 'e' },
    { id: '', title: 'Title only', evidence: '' }
  ]);

  const long = passingEntries({ auditDetails: { checks: { items: [okItem(`ok.dns.${'i'.repeat(300)}`, `T  ${'t'.repeat(500)}\n`, 'e'.repeat(1000), `https://ok.example/${'p'.repeat(1000)}`)] } } })[0];
  assert.equal(long.id.length, 120);
  assert.equal(long.title.length, 180);
  assert.ok(long.title.startsWith('T t') && long.title.endsWith('…'), 'whitespace is collapsed and the clip is marked');
  assert.equal(long.evidence.length, 300);
  assert.deepEqual(Object.keys(long), ['id', 'title', 'evidence']);

  const many = passingEntries({ auditDetails: { checks: { items: Array.from({ length: 450 }, (_, index) => okItem(`ok.tls.c${index}`)) } } });
  assert.equal(many.length, MAX_PASSING_ITEMS);
  assert.equal(MAX_PASSING_ITEMS, 300);
  assert.equal(many.at(-1).id, 'ok.tls.c299', 'the first items in the service order are kept');

  const heavy = passingEntries({ auditDetails: { checks: { items: Array.from({ length: 200 }, (_, index) => okItem(`ok.tls.c${index}`, 't'.repeat(180), 'e'.repeat(300), `https://ok.example/${'p'.repeat(300)}`)) } } });
  const chars = heavy.reduce((sum, item) => sum + item.id.length + item.title.length + item.evidence.length, 0);
  assert.ok(heavy.length < 200 && heavy.length > 0, `${heavy.length} long items fit the budget`);
  assert.equal(heavy.length, 81, 'only the text the popup shows (id, title, evidence: about 490 characters each here) counts against the budget');
  assert.ok(chars <= MAX_PASSING_CHARS, `${chars} characters`);
  assert.ok(JSON.stringify(heavy).length < 60_000, 'the stored list stays well below the storage quota');

  assert.deepEqual(passingEntries({}), []);
  assert.deepEqual(passingEntries({ auditDetails: { checks: { items: 'none' } } }), []);
  assert.deepEqual(interpret({ structuredContent: { status: 'completed', score: 90, findings: [] } }).passingItems, [], 'a result without checks has an empty list');
  assert.deepEqual(blockedOutcome({ kind: 'security', target: 'https://ok.example', reason: 'timeout' }).passingItems, []);
});

test('check ids map to the security module the service assigns them to', () => {
  const expected = {
    'ok.dns.resolve': 'dns',
    'ok.dns.email.spf': 'dns-email',
    'ok.dns.email.dmarc': 'dns-email',
    'ok.dns.caa': 'dns-email',
    'ok.rdap.lookup': 'rdap',
    'ok.tls.protocol.modern': 'tls',
    'ok.http.header.hsts': 'http-headers',
    'ok.http.cors.no-wildcard': 'http-headers',
    'ok.http.cors.no-reflection': 'http-methods',
    'ok.http.methods.no-dangerous-advertised': 'http-methods',
    'ok.http.trace.disabled': 'http-methods',
    'ok.mitm.no-mixed-content': 'mitm-posture',
    'ok.mitm.https-redirect': 'mitm-posture',
    'ok.tech.fingerprint.minimized': 'tech-fingerprint',
    'ok.exposure.env': 'exposure',
    'ok.api.swagger-json': 'api-exposure',
    'ok.auth.wp-admin': 'auth-surface',
    'ok.supply-chain.package-json': 'supply-chain',
    'ok.wordpress.xmlrpc.closed': 'wordpress',
    'ok.ports.risky-closed': 'ports',
    'port.intel.no-open-ports': 'port-intel',
    'ok.sqli.no-error-signal': 'sql-injection',
    'ok.resilience.edge-protection': 'ddos-resilience',
    'ok.secret-exposure.clean': 'secret-exposure',
    'ok.subdomain-takeover.no-dangling-cname': 'subdomain-takeover',
    'ok.cors-audit.restrictive': 'cors-audit',
    'ok.injection-canary.no-signal': 'injection-canary',
    'ok.transport-delivery.completed': 'transport-delivery',
    'pentest.recon-surface': 'pentest-suite',
    'ok.engine.nmap.completed': 'engine-nmap',
    'ok.engine.zap.completed': 'engine-zap',
    'ok.engine.unknown.completed': null,
    'ok.seo.title.home': null,
    'custom-check': null,
    '': null
  };
  for (const [id, module] of Object.entries(expected)) assert.equal(checkModule(id), module, id);
  assert.equal(checkModule(undefined), null);
});

test('the section groups the checks by module in the order of sitelemetry.com, other checks last', () => {
  const model = {
    passingChecks: 5,
    passingItems: [
      okItem('ok.tls.protocol.modern', 'Modern TLS protocol in use', 'TLSv1.3'),
      okItem('ok.custom.robots', 'A check of no known module'),
      okItem('ok.dns.resolve', 'DNS resolution successful', '203.0.113.24'),
      okItem('ok.tls.certificate.trusted', 'TLS certificate chain is trusted'),
      { id: 'ok.exposure.env', title: '', evidence: 'HTTP 404; path not found', location: '' }
    ]
  };
  const section = passingSection(model, t);
  assert.equal(section.title, `Passing checks${NBSP}(5)`);
  assert.equal(section.note, null, 'every counted check is listed');
  assert.deepEqual(section.groups.map((group) => [group.module, group.title]), [
    ['dns', `DNS posture${NBSP}(1)`],
    ['tls', `TLS / certificate${NBSP}(2)`],
    ['exposure', `Sensitive file exposure${NBSP}(1)`],
    [null, `Other checks${NBSP}(1)`]
  ]);
  assert.deepEqual(section.groups[1].items, [
    { title: 'Modern TLS protocol in use', evidence: 'TLSv1.3' },
    { title: 'TLS certificate chain is trusted', evidence: null }
  ], 'the service order is kept inside a group; an empty evidence is left out');
  assert.deepEqual(section.groups[2].items, [{ title: 'ok.exposure.env', evidence: 'HTTP 404; path not found' }], 'a check without a title shows its id');

  // More counted than kept: the heading gives both numbers, so it matches the count
  // under the score, and the note says how many are not listed.
  const truncated = passingSection({ ...model, passingChecks: 312 }, t);
  assert.equal(truncated.title, `Passing checks${NBSP}(5${NBSP}of${NBSP}312)`);
  assert.equal(truncated.note, '307 more passing check(s) were counted but not kept with this result, so they are not listed here.');
  assert.equal(truncated.groups.length, 4, 'the listed checks are still grouped');
  assert.equal(passingSection({ ...model, passingChecks: 3 }, t).title, `Passing checks${NBSP}(5)`, 'a smaller count than listed gives the listed number only');
  assert.equal(passingSection({ ...model, passingChecks: 3 }, t).note, null);

  const legacy = passingSection({ passingChecks: 62 }, t);
  assert.deepEqual(legacy, { title: `Passing checks${NBSP}(62)`, groups: [], note: en.passingLegacy.message }, 'a result stored by 0.1.2 shows the count and says when the list appears');
  assert.deepEqual(passingSection({ passingChecks: 8, passingItems: [] }, t), { title: `Passing checks${NBSP}(8)`, groups: [], note: en.passingNotListed.message });
  assert.equal(passingSection({ passingChecks: 0, passingItems: [] }, t), null);
  assert.equal(passingSection({ passingChecks: null }, t), null);
  assert.equal(passingSection({}, t), null);
});

test('the section reads in the translation shown, with the language\'s own parentheses', () => {
  const model = interpret(fixture('security-partial-redirects.json'), 'https://redirects.example');
  const expected = {
    en: [`Passing checks${NBSP}(29)`, `Email DNS${NBSP}(3)`],
    tr: [`Başarılı kontroller${NBSP}(29)`, `E-posta DNS${NBSP}(3)`],
    de: [`Bestandene Prüfungen${NBSP}(29)`, `E-Mail-DNS${NBSP}(3)`],
    ja: ['合格したチェック（29件）', 'メールDNS（3件）'],
    zh_CN: [`通过的检查（29${NBSP}项）`, `邮件 DNS（3${NBSP}项）`]
  };
  for (const [folder, [title, group]] of Object.entries(expected)) {
    const section = passingSection(model, createTranslator(load(folder), en));
    assert.equal(section.title, title, folder);
    assert.equal(section.groups.length, 11, folder);
    assert.equal(section.groups[1].title, group, `${folder}: module names come from the translation`);
  }
  const partial = {
    en: `Passing checks${NBSP}(1${NBSP}of${NBSP}40)`,
    tr: `Başarılı kontroller${NBSP}(40${NBSP}içinden${NBSP}1)`,
    de: `Bestandene Prüfungen${NBSP}(1${NBSP}von${NBSP}40)`,
    ja: '合格したチェック（40件中1件）',
    zh_CN: `通过的检查（列出${NBSP}1${NBSP}项，共${NBSP}40${NBSP}项）`
  };
  for (const folder of ['en', 'tr', 'es', 'de', 'fr', 'pt_BR', 'pt_PT', 'it', 'ja', 'zh_CN']) {
    const translate = createTranslator(load(folder), en);
    const section = passingSection({ passingChecks: 40, passingItems: [okItem('ok.dns.resolve')] }, translate);
    assert.ok(section.note.includes('39'), `${folder}: ${section.note}`);
    assert.ok(section.title.includes('1') && section.title.includes('40'), `${folder}: ${section.title}`);
    if (partial[folder]) assert.equal(section.title, partial[folder], folder);
  }
});

// The general /mcp endpoint the extension uses keeps no report of the audit in the
// Sitelemetry app, so no note may send the user to one (test/report-words.mjs).
test('no passing-check note refers to a report in the Sitelemetry app', () => {
  for (const [folder, pattern] of Object.entries(REPORT_OR_APP)) {
    const locale = load(folder);
    for (const key of ['passingMore', 'passingNotListed', 'passingLegacy']) assert.doesNotMatch(locale[key].message, pattern, `${folder}/${key}`);
  }
});

test('the AI fix prompt is the same with or without the stored passing checks', () => {
  const entry = { model: interpret(fixture('security-partial-redirects.json'), 'https://redirects.example'), finishedAt: Date.UTC(2026, 8, 26, 9), kind: 'security' };
  assert.equal(entry.model.passingItems.length, 29);
  const { passingItems, ...legacy } = entry.model;
  assert.ok(passingItems.length);
  const prompt = buildFixPrompt(entry, { t });
  assert.equal(prompt, buildFixPrompt({ ...entry, model: legacy }, { t }));
  assert.doesNotMatch(prompt, /DNS resolution successful|Clickjacking protection present/, 'the passing checks are not part of the prompt');
  assert.match(prompt, /^- Passing checks: 29$/m, 'the prompt keeps the count only');
});
