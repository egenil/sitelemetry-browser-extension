// "What was not measured": readable module names, status words and explanations
// chosen from the module id and language-independent tokens in the service's
// reasons, so the same explanation is given whatever report language the service
// used. The reasons below are the service's own wording in its report languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFixPrompt } from '../src/shared/fix-prompt.js';
import { createTranslator } from '../src/shared/i18n.js';
import { explainModule, moduleLabel, notMeasuredText, notMeasuredView } from '../src/shared/not-measured.js';
import { MAX_REASONS_CHARS, interpretOutcome, notMeasuredEntries } from '../src/shared/outcome.js';
import { notMeasuredSection, severityCountText } from '../src/shared/text.js';
import { fixture } from './mock-server.mjs';

const load = (folder) => JSON.parse(readFileSync(new URL(`../_locales/${folder}/messages.json`, import.meta.url), 'utf8'));
const en = load('en');
const t = createTranslator(en);
const tr = createTranslator(load('tr'), en);

// The list a Next.js/NextAuth site produced: unknown paths answer 307 to the sign-in
// page, trailing-slash paths 308; twelve ports are silently dropped by a firewall.
const REASONS = {
  en: {
    redirect: 'HTTP 307; redirect was not followed',
    permanent: 'HTTP 308; redirect was not followed',
    ports: '12 timeout/filtered; 0 network error',
    secrets: '0/7 resource(s) could not be assessed; 7 script(s) remained outside the bounded scan.'
  },
  tr: {
    redirect: 'HTTP 307; yönlendirme takip edilmedi',
    permanent: 'HTTP 308; yönlendirme takip edilmedi',
    ports: '12 zaman aşımı/filtreli; 0 ağ hatası',
    secrets: '0/7 kaynak değerlendirilemedi; 7 betik sınırlı tarama kapsamı dışında kaldı.'
  },
  ja: {
    redirect: 'HTTP 307; リダイレクトは追跡されませんでした',
    permanent: 'HTTP 308; リダイレクトは追跡されませんでした',
    ports: '12 件のタイムアウト・フィルタリング、0 件のネットワークエラー',
    secrets: '0/7 件のリソースを評価できませんでした; 7 件のスクリプトが制限付きスキャンの対象外でした.'
  },
  zh: {
    redirect: 'HTTP 307；未跟随重定向',
    permanent: 'HTTP 308；未跟随重定向',
    ports: '12 个超时或被过滤；0 个网络错误',
    secrets: '无法评估 0/7 个资源; 7 个脚本未纳入受限扫描.'
  },
  de: {
    redirect: 'HTTP 307; Weiterleitung wurde nicht verfolgt',
    permanent: 'HTTP 308; Weiterleitung wurde nicht verfolgt',
    ports: '12 Zeitüberschreitungen/gefiltert; 0 Netzwerkfehler',
    secrets: '0/7 Ressourcen konnten nicht ausgewertet werden; 7 Skripte blieben außerhalb des begrenzten Scans.'
  }
};
const moduleResults = (r) => [
  { module: 'dns', status: 'measured' },
  { module: 'exposure', status: 'unavailable', reasons: [r.redirect] },
  { module: 'api-exposure', status: 'partial', reasons: [r.redirect, r.permanent] },
  { module: 'auth-surface', status: 'partial', reasons: [r.redirect, r.permanent] },
  { module: 'supply-chain', status: 'unavailable', reasons: [r.redirect] },
  { module: 'ports', status: 'partial', reasons: [r.ports] },
  { module: 'port-intel', status: 'partial', reasons: [r.ports] },
  { module: 'secret-exposure', status: 'partial', reasons: [r.secrets] }
];
const entriesFor = (lang) => notMeasuredEntries({ auditDetails: { scope: { status: 'partial', moduleResults: moduleResults(REASONS[lang]) } } });

const REDIRECT_307 = 'The site answers these paths with a redirect (HTTP 307), for example to its sign-in page. Sitelemetry does not follow redirects for these checks, so they were not measured.';
const REDIRECT_BOTH = 'The site answers these paths with a redirect (HTTP 307/308), for example to its sign-in page. Sitelemetry does not follow redirects for these checks, so they were not measured.';
const PORTS_12 = '12 ports gave no reply: a firewall, usually the site\'s own, silently drops these connection attempts. This is normal hardening; silent ports are counted neither as open nor as closed.';
const SCRIPTS = 'Only a limited number of scripts is scanned per audit; the remaining scripts were not checked and are not counted as clean.';

test('the redirect/firewall list reads as the site\'s own setup, with the service reason kept', () => {
  const views = entriesFor('en').map((entry) => notMeasuredView(entry, t));
  assert.deepEqual(views.map((view) => [view.text, view.explanation]), [
    ['Sensitive file exposure: not measured', REDIRECT_307],
    ['API / GraphQL exposure: partly measured', REDIRECT_BOTH],
    ['Admin / login surface: partly measured', REDIRECT_BOTH],
    ['Supply-chain files: not measured', REDIRECT_307],
    ['Port scan: partly measured', PORTS_12],
    ['Port risk intelligence: partly measured', PORTS_12],
    ['Leaked secrets: partly measured', SCRIPTS]
  ]);
  assert.equal(views[0].detail, 'Reported by the audit: HTTP 307; redirect was not followed');
  assert.equal(views[1].detail, 'Reported by the audit: HTTP 307; redirect was not followed; HTTP 308; redirect was not followed');
  assert.equal(views[4].detail, 'Reported by the audit: 12 timeout/filtered; 0 network error');
  assert.equal(views[6].detail, 'Reported by the audit: 0/7 resource(s) could not be assessed; 7 script(s) remained outside the bounded scan.');
  assert.ok(views.every((view) => !/Module |unavailable|partial\b/.test(view.text)), 'no raw ids or status codes in the item');
});

test('the same explanations are chosen whatever language the service reported in', () => {
  const explanations = (lang, translate = t) => entriesFor(lang).map((entry) => notMeasuredView(entry, translate).explanation);
  const english = explanations('en');
  assert.ok(english.every(Boolean));
  for (const lang of ['tr', 'ja', 'zh', 'de']) assert.deepEqual(explanations(lang), english, `service language ${lang}`);
  // And the detail line keeps the service's own words, in its language.
  assert.equal(notMeasuredView(entriesFor('ja')[0], t).detail, 'Reported by the audit: HTTP 307; リダイレクトは追跡されませんでした');
  assert.equal(notMeasuredView(entriesFor('tr')[4], tr).detail, 'Denetimin bildirdiği: 12 zaman aşımı/filtreli; 0 ağ hatası');
});

test('a Turkish popup explains the Turkish report in Turkish', () => {
  const views = entriesFor('tr').map((entry) => notMeasuredView(entry, tr));
  assert.deepEqual(views.map((view) => view.text), [
    'Hassas dosya maruziyeti: ölçülmedi',
    'API / GraphQL maruziyeti: kısmen ölçüldü',
    'Admin / giriş yüzeyi: kısmen ölçüldü',
    'Tedarik zinciri dosyaları: ölçülmedi',
    'Port taraması: kısmen ölçüldü',
    'Port risk istihbaratı: kısmen ölçüldü',
    'Sızdırılmış secret’lar: kısmen ölçüldü'
  ]);
  assert.equal(views[1].explanation, 'Site bu yollara yönlendirmeyle yanıt veriyor (HTTP 307/308), örneğin kendi giriş sayfasına. Sitelemetry bu kontrollerde yönlendirmeleri takip etmez; bu yüzden bunlar ölçülmedi.');
  assert.match(views[4].explanation, /^12 port yanıt vermedi: bir güvenlik duvarı/);
  assert.match(views[6].explanation, /^Her denetimde yalnızca sınırlı sayıda betik taranır/);
  assert.equal(views[0].detail, 'Denetimin bildirdiği: HTTP 307; yönlendirme takip edilmedi');
});

test('every shipped language has the explanations, the status words and the module names', () => {
  for (const folder of ['tr', 'es', 'de', 'fr', 'pt_BR', 'it', 'ja', 'zh_CN']) {
    const translate = createTranslator(load(folder), en);
    for (const entry of entriesFor('en')) {
      const view = notMeasuredView(entry, translate);
      assert.ok(view.explanation && view.detail, `${folder}: ${entry.subs[0]}`);
      assert.notEqual(view.text, notMeasuredView(entry, t).text, `${folder}: ${entry.subs[0]} is translated`);
    }
    assert.match(notMeasuredView(entriesFor('en')[1], translate).explanation, /HTTP 307\/308/);
    assert.match(notMeasuredView(entriesFor('en')[4], translate).explanation, /12/);
  }
});

test('rate limits, server errors and timeouts on path checks are explained in any report language', () => {
  assert.equal(explainModule('exposure', 'HTTP 429; request was rate limited', t), 'The site rate-limited these requests (its own protection).');
  assert.equal(explainModule('supply-chain', 'HTTP 503; sunucu hatası', t), 'The site returned a server error for these requests.');
  assert.equal(explainModule('auth-surface', '応答なし/タイムアウト、結果は不確定です', t), 'The site did not answer within the time limit.');
  assert.equal(explainModule('api-exposure', 'Sin respuesta/tiempo agotado; resultado no concluyente', t), 'The site did not answer within the time limit.');
  assert.equal(explainModule('exposure', 'HTTP 302; redirect was not followed; HTTP 429; request was rate limited; No response/timeout; result inconclusive', t),
    'The site answers these paths with a redirect (HTTP 302), for example to its sign-in page. Sitelemetry does not follow redirects for these checks, so they were not measured. The site rate-limited these requests (its own protection). The site did not answer within the time limit.');
});

test('the port explanation counts the silent ports, has a singular form and leaves network errors alone', () => {
  assert.equal(explainModule('ports', '1 timeout/filtered; 0 network error', t), '1 port gave no reply: a firewall, usually the site\'s own, silently drops these connection attempts. This is normal hardening; silent ports are counted neither as open nor as closed.');
  assert.equal(explainModule('ports', '12 timeout/filtered and 0 network-error port result(s) were not verified', t), PORTS_12);
  assert.equal(explainModule('ports', '12 timeout/filtered and 2 network-error port result(s) were not verified', t), null, 'network errors can have other causes');
  assert.equal(explainModule('port-intel', 'The source TCP port scan did not complete.', t), null, 'no counts, no guess');
  assert.equal(explainModule('port-intel', 'La scansione di origine delle porte TCP era incompleta.', t), null);
  assert.equal(explainModule('ports', '0 timeout/filtered; 3 network error', t), null, 'network errors are not a firewall');
  assert.equal(explainModule('ports', '4 timeout/filtered; 0 network error; 9 other', t), null);
});

test('anything not recognised keeps the status word and the service reason, as before', () => {
  const view = (subs) => notMeasuredView({ key: 'nmModuleStatusReasons', subs }, t);
  assert.deepEqual(view(['rdap', 'unavailable', 'registry_timeout']), { text: 'WHOIS / RDAP: not measured (registry_timeout)', explanation: null, detail: null });
  assert.equal(view(['exposure', 'partial', 'HTTP 403; ambiguous client-error response']).text, 'Sensitive file exposure: partly measured (HTTP 403; ambiguous client-error response)');
  assert.equal(view(['exposure', 'partial', 'HTTP 307; redirect was not followed; HTTP 403; ambiguous client-error response']).explanation, null, 'a mixed list is not explained away');
  assert.equal(view(['exposure', 'partial', 'engine error']).explanation, null);
  assert.equal(view(['secret-exposure', 'partial', '2/7 resource(s) could not be assessed (https://a.example/x.js: HTTP 503, 10B received/0B inspected; https://a.example/y.js: no response).']).explanation, null, 'failed resources are not a scan limit');
  assert.equal(view(['secret-exposure', 'partial', '2/7 resource(s) could not be assessed (https://a.example/x.js: no response); 3 script(s) remained outside the bounded scan.']).explanation, SCRIPTS);
  assert.equal(view(['secret-exposure', 'partial', '0/7 resource(s) could not be assessed; https://a.example/chunk-12…']).explanation, null, 'a cut reason is not guessed at');
  assert.equal(view(['http-methods', 'unavailable', 'HTTP 307; redirect was not followed']).explanation, null, 'only the path modules get the redirect explanation');
  assert.equal(view(['engine-foo', 'degraded', 'x']).text, 'engine-foo: degraded (x)', 'unknown ids and statuses are shown as they are');
  assert.equal(notMeasuredView({ key: 'nmModuleStatus', subs: ['ports', 'partial'] }, t).text, 'Port scan: partly measured');
  assert.equal(moduleLabel('engine-nmap', t), 'Nmap');
  assert.equal(moduleLabel('api-exposure', () => 'moduleApiExposure'), 'api-exposure', 'a missing translation falls back to the id');
});

test('module lists, other entries and the one-line form for the AI prompt', () => {
  assert.equal(notMeasuredText({ key: 'nmVerificationModules', subs: ['http-methods, exposure, new-module'] }, t), 'Security modules that require ownership verification of the site: HTTP methods / CORS, Sensitive file exposure, new-module');
  assert.equal(notMeasuredText({ key: 'nmModulesNotInPlan', subs: ['ports, wordpress'] }, tr), 'Bağlı planın dışındaki güvenlik modülleri: Port taraması, WordPress duruşu');
  assert.equal(notMeasuredText({ key: 'nmPillarFailed', subs: ['Performance', 'PageSpeed Insights was unavailable.'] }, t), 'Performance: PageSpeed Insights was unavailable.');
  assert.equal(notMeasuredText(entriesFor('en')[0], t), `Sensitive file exposure: not measured. ${REDIRECT_307} Reported by the audit: HTTP 307; redirect was not followed`);
});

test('a stored result and a long reason keep working: reasons are kept whole for the explanation and shortened when shown', () => {
  const model = interpretOutcome({ outcome: 'result', result: fixture('security-partial-redirects.json') }, { kind: 'security', target: 'https://redirects.example' });
  assert.equal(model.status, 'partial');
  assert.equal(model.notMeasured.length, 7);
  assert.deepEqual(model.notMeasured[0], { key: 'nmModuleStatusReasons', subs: ['exposure', 'unavailable', 'HTTP 307; redirect was not followed'] });
  const redirects = Array.from({ length: 40 }, (_, i) => `HTTP 30${i % 2 ? 8 : 7}; redirect was not followed`).join('; ');
  const long = notMeasuredEntries({ auditDetails: { scope: { moduleResults: [{ module: 'exposure', status: 'partial', reasons: [redirects, 'HTTP 403; ambiguous client-error response'] }] } } });
  assert.ok(long[0].subs[2].length > 300 && long[0].subs[2].endsWith('HTTP 403; ambiguous client-error response'), 'the whole reason is stored');
  const view = notMeasuredView(long[0], t);
  assert.equal(view.explanation, null, 'a status past the shown part still counts');
  assert.ok(view.text.endsWith('…)') && view.text.length < 400, 'the shown reason is shortened');
  const cut = notMeasuredEntries({ auditDetails: { scope: { moduleResults: [{ module: 'exposure', status: 'partial', reasons: [redirects.repeat(3)] }] } } });
  assert.equal(cut[0].subs[2].length, MAX_REASONS_CHARS);
  assert.equal(notMeasuredView(cut[0], t).explanation, REDIRECT_BOTH);
  assert.ok(notMeasuredView(cut[0], t).detail.endsWith('…'));
});

// The engine's reason when a WAF or CDN refuses some script chunks: the failed
// resources first, then the scripts left outside the scan. At 348 characters its
// end is past the part that is shown.
const FAILED_SCRIPTS = {
  en: '2/7 resource(s) could not be assessed (https://www.normesta.com/_next/static/chunks/app/(dashboard)/settings/page-0123456789abcdef0.js: HTTP 403, 9B received/0B inspected; https://www.normesta.com/_next/static/chunks/app/(dashboard)/layout-0123456789abcdef0.js: HTTP 403, 9B received/0B inspected); 7 script(s) remained outside the bounded scan.',
  ja: '2/7 件のリソースを評価できませんでした (https://www.normesta.com/_next/static/chunks/app/(dashboard)/settings/page-0123456789abcdef0.js: HTTP 403, 9B received/0B inspected; https://www.normesta.com/_next/static/chunks/app/(dashboard)/layout-0123456789abcdef0.js: HTTP 403, 9B received/0B inspected); 7 件のスクリプトが制限付きスキャンの対象外でした.'
};

test('the scan-limit explanation survives a long list of failed scripts, in the popup and the AI prompt', () => {
  assert.ok(FAILED_SCRIPTS.en.length > 300);
  const ja = createTranslator(load('ja'), en);
  for (const [lang, translate] of [['en', t], ['ja', ja]]) {
    const [entry] = notMeasuredEntries({ auditDetails: { scope: { moduleResults: [{ module: 'secret-exposure', status: 'partial', reasons: [FAILED_SCRIPTS[lang]] }] } } });
    assert.equal(entry.subs[2], FAILED_SCRIPTS[lang]);
    const view = notMeasuredView(entry, translate);
    assert.equal(view.explanation, translate('explainScriptLimit'), lang);
    assert.ok(view.detail.endsWith('…') && view.detail.length < 360, `${lang}: the reason is shortened when shown`);
    assert.ok(notMeasuredText(entry, translate).includes(translate('explainScriptLimit')), `${lang}: the one-line form keeps the explanation`);
    const model = { kind: 'security', target: 'https://www.normesta.com', status: 'partial', counts: {}, total: 0, findings: [], notMeasured: [entry] };
    const prompt = buildFixPrompt({ model, finishedAt: Date.UTC(2026, 8, 25) }, { t: translate, language: lang });
    const item = `- ${translate('nmModuleStatus', [translate('moduleSecretExposure'), translate('nmPartlyMeasured')])}`;
    assert.ok(prompt.split('\n').some((line) => line.startsWith(item) && line.includes(translate('explainScriptLimit'))), `${lang}: the AI prompt keeps the explanation`);
  }
});

test('the note names the causes only when an item is explained, and speaks of those items only', () => {
  const partial = (notMeasured) => ({ status: 'partial', notMeasured });
  const explained = notMeasuredSection(partial(entriesFor('en')), t);
  assert.equal(explained.note, en.notMeasuredNoteExplained.message);
  assert.match(explained.note, /^Explained items /);
  assert.equal(explained.items.length, 7);
  // A registry timeout or an engine outage is not the site's setup: with nothing
  // explained, the note only says that unmeasured checks are not passes.
  const raw = partial([
    { key: 'nmModuleStatusReasons', subs: ['rdap', 'unavailable', 'registry_timeout'] },
    { key: 'nmModuleStatusReasons', subs: ['engine-nuclei', 'unavailable', 'exe=not found | Defender/AV quarantine likely'] },
    { key: 'nmPillarFailed', subs: ['Performance', 'PageSpeed Insights was unavailable for this target.'] }
  ]);
  assert.equal(notMeasuredSection(raw, t).note, 'Unmeasured checks are not counted as passes.');
  assert.equal(notMeasuredSection(partial([...raw.notMeasured, entriesFor('en')[4]]), t).note, en.notMeasuredNoteExplained.message, 'a mixed list uses the scoped note');
  assert.deepEqual(notMeasuredSection(partial([]), t), { title: 'What was not measured (1)', note: 'Unmeasured checks are not counted as passes.', items: [{ text: en.nmUnknown.message, explanation: null, detail: null }] });
  for (const folder of ['tr', 'es', 'de', 'fr', 'pt_BR', 'it', 'ja', 'zh_CN']) {
    const locale = load(folder);
    const translate = createTranslator(locale, en);
    assert.equal(notMeasuredSection(partial(entriesFor('en')), translate).note, locale.notMeasuredNoteExplained.message, folder);
    assert.equal(notMeasuredSection(raw, translate).note, locale.notMeasuredNote.message, folder);
  }
});

// The closed section's heading: the translated title and the number of items, with
// the language's own parentheses; a line never starts with the number or its bracket.
test('the section heading carries the number of items in every language', () => {
  const section = (folder, notMeasured) => notMeasuredSection({ status: 'partial', notMeasured }, createTranslator(load(folder), en));
  assert.equal(section('en', entriesFor('en')).title, 'What was not measured (7)');
  assert.equal(section('tr', entriesFor('tr')).title, 'Neler ölçülmedi (7)');
  assert.equal(section('de', entriesFor('en')).title, 'Was nicht gemessen wurde (7)');
  assert.equal(section('fr', entriesFor('en')).title, 'Ce qui n’a pas été mesuré (7)');
  assert.equal(section('ja', entriesFor('ja')).title, '測定されなかった項目（7件）');
  assert.equal(section('zh_CN', entriesFor('en')).title, '未测量的内容（7 项）');
  assert.equal(section('es', []).title, 'Qué no se midió (1)', 'the placeholder item is counted like the list shows it');
  for (const folder of ['en', 'tr', 'es', 'de', 'fr', 'pt_BR', 'pt_PT', 'it', 'ja', 'zh_CN']) {
    const locale = load(folder);
    const { title, items } = section(folder, entriesFor('en').slice(0, 3));
    assert.equal(items.length, 3, folder);
    assert.ok(title.startsWith(locale.notMeasuredTitle.message), `${folder}: the title comes first`);
    assert.ok(title.includes('3'), `${folder}: the count is shown`);
    assert.doesNotMatch(title, / [(（\d]/, `${folder}: no breakable space before the count`);
  }
});

test('severity chips never make a label agree with a number', () => {
  const chip = (folder, severity, count) => severityCountText(severity, count, createTranslator(load(folder), en));
  assert.equal(chip('en', 'critical', 3), '3 critical');
  assert.equal(chip('tr', 'high', 2), '2 yüksek');
  assert.equal(chip('de', 'medium', 4), '4 mittel');
  assert.equal(chip('es', 'critical', 3), 'crítico: 3');
  assert.equal(chip('pt_BR', 'high', 2), 'alto: 2');
  assert.equal(chip('it', 'critical', 3), 'critico: 3');
  assert.equal(chip('fr', 'high', 2), 'élevé\u00A0: 2');
  assert.equal(chip('ja', 'critical', 3), '緊急 3件');
  assert.equal(chip('zh_CN', 'high', 2), '高危 2 项');
});
