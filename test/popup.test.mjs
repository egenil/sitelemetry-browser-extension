// The popup's result view, rendered by the real popup module in a small DOM
// (test/fake-dom.mjs) with a stub of the chrome.* APIs it uses. Every case loads a
// fresh module instance, because the popup renders from storage at load time.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTranslator } from '../src/shared/i18n.js';
import { interpretOutcome, normalizeFinding } from '../src/shared/outcome.js';
import { FakeDocument } from './fake-dom.mjs';
import { fixture } from './mock-server.mjs';

const load = (folder) => JSON.parse(readFileSync(new URL(`../_locales/${folder}/messages.json`, import.meta.url), 'utf8'));
const en = load('en');
const ORIGIN = 'https://www.example.com';
const NBSP = ' ';

let loads = 0;
const loadPopup = () => import(`../src/popup/popup.js?case=${++loads}`);
const settle = async (ticks = 20) => { for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

const entry = (name, finishedAt, lang = 'en') => ({
  model: interpretOutcome({ outcome: 'result', tool: 'audit_security', jobId: 'mj_demo', result: fixture(name) }, { kind: 'security', target: ORIGIN }),
  finishedAt,
  kind: 'security',
  lang
});

// chrome.* as the popup uses it: messages of one locale backed by English, storage
// with change events, one active tab, no worker to connect to. The plan catalogue
// request waits until the test releases it, so a re-render can be timed.
function stubChrome({ folder = 'en', language = 'en', result }) {
  const messages = folder === 'en' ? en : load(folder);
  const translate = createTranslator(messages, en);
  const store = { apiKey: 'sl_test_key', ownershipAcknowledgedAt: Date.now() - 1000, results: { [ORIGIN]: result } };
  const listeners = [];
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  let releasePlans;
  const plansRequested = new Promise((resolve) => {
    globalThis.fetch = () => {
      resolve();
      return new Promise((release) => { releasePlans = () => release({ ok: true, json: async () => fixture('plans.json') }); });
    };
  });
  globalThis.document = new FakeDocument();
  globalThis.chrome = {
    i18n: { getMessage: (key, subs) => (messages[key] || en[key] ? translate(key, subs) : ''), getUILanguage: () => language },
    storage: {
      local: {
        async get(keys) {
          const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const name of names) if (store[name] !== undefined) out[name] = clone(store[name]);
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: clone(store[key]), newValue: clone(value) };
            store[key] = clone(value);
          }
          setTimeout(() => { for (const listener of listeners) listener(changes, 'local'); }, 0);
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    tabs: { query: async () => [{ id: 1, url: `${ORIGIN}/pricing`, active: true }] },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      openOptionsPage() {},
      connect() { throw new Error('no service worker in this test'); }
    }
  };
  return { store, plansRequested, releasePlans: () => releasePlans() };
}

async function openPopup(options) {
  const chrome = stubChrome(options);
  await loadPopup();
  await settle();
  const view = document.getElementById('view-result');
  assert.equal(document.getElementById('error').hidden, true, 'the popup initialised without an error');
  assert.equal(view.hidden, false, 'the result view is shown');
  return { chrome, view };
}

const nodeFetch = globalThis.fetch;
afterEach(() => {
  delete globalThis.document;
  delete globalThis.chrome;
  globalThis.fetch = nodeFetch;
});

test('"What was not measured" is a closed disclosure whose heading carries the number of items', async () => {
  const { view } = await openPopup({ result: entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 10)) });
  const sections = view.querySelectorAll('details.nm-section');
  assert.equal(sections.length, 1);
  const [details] = sections;
  assert.equal(details.open, false, 'closed by default');
  const summary = details.firstElementChild;
  assert.equal(summary.localName, 'summary', 'the summary is the first child, so it is the disclosure button');
  assert.equal(summary.className, 'section-title nm-summary', 'it keeps the look of the other section headings');
  const heading = summary.querySelector('h3');
  assert.ok(heading, 'the heading stays a heading inside the summary');
  assert.equal(summary.textContent, `What was not measured${NBSP}(7)`);
  assert.equal(heading.textContent, en.sectionCount.message.replace('$TITLE$', en.notMeasuredTitle.message).replace('$COUNT$', '7'));

  // The note and the list are inside the details, the list has one item per entry.
  const list = details.querySelector('ul.nm-list');
  assert.ok(list, 'the list is inside the details');
  assert.equal(list.childElementCount, 7);
  assert.equal(details.querySelector('p.muted').textContent, en.notMeasuredNoteExplained.message);
  assert.deepEqual(details.children.map((child) => child.localName), ['summary', 'p', 'ul']);
  assert.equal(list.children[0].querySelector('.nm-text').textContent, 'Sensitive file exposure: not measured');
  assert.equal(view.querySelectorAll('ul.nm-list').length, 1, 'no list outside the details');

  // The other sections are unchanged: the top findings heading and the prompt box.
  // The order is: findings, passing checks, what was not measured, the prompt box.
  const card = view.querySelector('section.result');
  assert.deepEqual(card.children.filter((child) => child.matches('h3.section-title')).map((h) => h.textContent), [en.topFindingsTitle.message]);
  const position = (element) => card.children.indexOf(element);
  const lastFinding = card.querySelectorAll('details.finding').at(-1);
  const passing = card.querySelector('details.passing-section');
  assert.ok(position(lastFinding) < position(passing) && position(passing) < position(details), 'findings, then passing checks, then what was not measured');
  assert.ok(position(details) < position(card.querySelector('.prompt-box')), 'the prompt box still follows the section');
  assert.equal(card.querySelector('.prompt-details').open, false);

  // Clicking the summary opens it.
  summary.click();
  await settle();
  assert.equal(details.open, true);
});

test('an open section stays open, with focus, while the same result is shown again; a new result closes it', async () => {
  const first = entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 10));
  const { chrome, view } = await openPopup({ result: first });
  await chrome.plansRequested;
  const details = view.querySelector('details.nm-section');
  const summary = details.firstElementChild;
  summary.focus();
  summary.click();
  await settle();
  assert.equal(details.open, true);

  // A storage update for the same result (the job list, the stored result again)
  // renders without rebuilding the view: the same element, still open and focused.
  await globalThis.chrome.storage.local.set({ jobs: {}, results: { [ORIGIN]: first } });
  await settle();
  assert.ok(view.querySelector('details.nm-section') === details, 'the view was not rebuilt');
  assert.equal(details.open, true);
  assert.ok(document.activeElement === summary, 'the heading keeps focus');

  // The plan facts arriving rebuild the view for the same result: the new section
  // opens again and the heading keeps keyboard focus.
  chrome.releasePlans();
  await settle();
  const rebuilt = view.querySelector('details.nm-section');
  assert.ok(rebuilt !== details, 'the plan facts rebuild the view');
  assert.equal(details.isConnected, false);
  assert.equal(rebuilt.open, true, 'still open after the rebuild');
  assert.ok(document.activeElement === rebuilt.firstElementChild, 'focus moved to the new heading');
  await settle();
  assert.equal(rebuilt.open, true, 'the toggle event of the reopened section keeps it open');

  // A new result starts closed again.
  await globalThis.chrome.storage.local.set({ results: { [ORIGIN]: entry('security-partial-free.json', Date.UTC(2026, 8, 25, 11)) } });
  await settle();
  const fresh = view.querySelector('details.nm-section');
  assert.ok(fresh !== rebuilt, 'a new result rebuilds the view');
  assert.equal(fresh.open, false, 'a new result resets the section to closed');
  assert.equal(fresh.firstElementChild.textContent, `What was not measured${NBSP}(2)`);
  assert.equal(fresh.querySelector('ul.nm-list').childElementCount, 2);
});

test('the heading and its count follow the translation shown, with the language\'s own parentheses', async () => {
  const expected = {
    tr: `Neler ölçülmedi${NBSP}(7)`,
    ja: '測定されなかった項目（7件）',
    zh_CN: `未测量的内容（7${NBSP}项）`
  };
  for (const [folder, text] of Object.entries(expected)) {
    const language = folder.replace('_', '-');
    const fixtureName = folder === 'tr' ? 'security-partial-redirects-tr.json' : 'security-partial-redirects.json';
    const { view } = await openPopup({ folder, language, result: entry(fixtureName, Date.UTC(2026, 8, 25, 10), language) });
    const details = view.querySelector('details.nm-section');
    assert.equal(details.open, false, folder);
    assert.equal(details.firstElementChild.textContent, text, folder);
    assert.equal(details.querySelector('ul.nm-list').childElementCount, 7, folder);
  }
});

test('a result without unmeasured checks has no "What was not measured" section', async () => {
  const { view } = await openPopup({ result: entry('security-completed.json', Date.UTC(2026, 8, 25, 10)) });
  assert.equal(view.querySelector('.nm-section'), null);
  assert.equal(view.querySelector('.nm-list'), null);
  assert.equal(view.querySelector('details.passing-section summary').textContent, `Passing checks${NBSP}(12)`, 'the passing checks are shown for a completed result too');
  assert.ok(view.querySelector('.prompt-box'), 'the rest of the result view is rendered');
});

test('"Passing checks" is a closed disclosure that lists the checks by module, each with its evidence', async () => {
  const { view } = await openPopup({ result: entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 10)) });
  const sections = view.querySelectorAll('details.passing-section');
  assert.equal(sections.length, 1);
  const [details] = sections;
  assert.equal(details.open, false, 'closed by default');
  const summary = details.firstElementChild;
  assert.equal(summary.localName, 'summary');
  assert.equal(summary.className, 'section-title passing-summary', 'the same look as "What was not measured"');
  assert.ok(details.classList.contains('toggle-section') && view.querySelector('details.nm-section').classList.contains('toggle-section'), 'both sections share the disclosure style');
  assert.equal(summary.querySelector('h3').textContent, `Passing checks${NBSP}(29)`);
  assert.ok(view.querySelector('.score-meta').textContent.includes('29 passing checks'), 'the heading matches the count under the score');

  const groups = details.querySelectorAll('div.passing-group');
  assert.deepEqual(groups.map((group) => group.querySelector('h4').textContent), [
    `DNS posture${NBSP}(1)`, `Email DNS${NBSP}(3)`, `WHOIS / RDAP${NBSP}(1)`, `TLS / certificate${NBSP}(3)`, `HTTP security headers${NBSP}(5)`,
    `MITM / HTTPS posture${NBSP}(1)`, `HTTP methods / CORS${NBSP}(3)`, `API / GraphQL exposure${NBSP}(5)`, `Admin / login surface${NBSP}(4)`,
    `Port scan${NBSP}(2)`, `Leaked secrets${NBSP}(1)`
  ]);
  assert.equal(details.querySelectorAll('ul.passing-list li').length, 29);
  const row = (li) => [li.querySelector('.passing-title').textContent, li.querySelector('.passing-evidence')?.textContent ?? null];
  assert.deepEqual(groups[3].querySelectorAll('li').map(row), [
    ['TLS certificate chain is trusted', "issuer=C=US, O=Let's Encrypt, CN=R11"],
    ['TLS certificate validity is healthy', 'valid_to=Dec 12 08:14:33 2026 GMT'],
    ['Modern TLS protocol in use', 'TLSv1.3']
  ]);
  assert.deepEqual(row(groups[8].querySelectorAll('li').at(-1)), ['/server-status is protected', 'HTTP 403; anonymous access denied']);
  assert.equal(details.querySelector('.passing-note'), null, 'every counted check is listed');
  assert.doesNotMatch(details.textContent, /inconclusive|redirect was not followed|partial$/m, 'skipped checks are not listed as passing');

  summary.click();
  await settle();
  assert.equal(details.open, true);
  assert.equal(view.querySelector('details.nm-section').open, false, 'the sections open independently');
});

test('both sections keep their open state and the heading keeps focus for the same result; a new result closes both', async () => {
  const first = entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 10));
  const { chrome, view } = await openPopup({ result: first });
  await chrome.plansRequested;
  const passing = view.querySelector('details.passing-section');
  passing.firstElementChild.focus();
  passing.firstElementChild.click();
  view.querySelector('details.nm-section').firstElementChild.click();
  await settle();
  assert.equal(passing.open, true);

  await globalThis.chrome.storage.local.set({ results: { [ORIGIN]: first } });
  await settle();
  assert.ok(view.querySelector('details.passing-section') === passing, 'the same result is not rebuilt');
  assert.ok(document.activeElement === passing.firstElementChild);

  chrome.releasePlans();
  await settle();
  const rebuilt = view.querySelector('details.passing-section');
  assert.ok(rebuilt !== passing, 'the plan facts rebuild the view');
  assert.equal(rebuilt.open, true, 'the passing checks stay open');
  assert.equal(view.querySelector('details.nm-section').open, true, 'what was not measured stays open');
  assert.ok(document.activeElement === rebuilt.firstElementChild, 'focus moved to the new passing checks heading');

  await globalThis.chrome.storage.local.set({ results: { [ORIGIN]: entry('security-completed.json', Date.UTC(2026, 8, 25, 11)) } });
  await settle();
  const fresh = view.querySelector('details.passing-section');
  assert.equal(fresh.open, false, 'a new result starts closed');
  assert.equal(fresh.firstElementChild.textContent, `Passing checks${NBSP}(12)`);
  assert.equal(fresh.querySelectorAll('li').length, 12);

  // Back to a partial result: both sections are closed again.
  await globalThis.chrome.storage.local.set({ results: { [ORIGIN]: entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 12)) } });
  await settle();
  assert.deepEqual(view.querySelectorAll('details.toggle-section').map((section) => [section.getAttribute('data-section'), section.open]), [['passing', false], ['nm', false]]);
});

test('a result stored by 0.1.2 without the list shows the count and when the list appears', async () => {
  const legacy = entry('security-completed.json', Date.UTC(2026, 8, 24, 10));
  delete legacy.model.passingItems;
  const { view } = await openPopup({ result: legacy });
  const details = view.querySelector('details.passing-section');
  assert.equal(details.open, false);
  assert.equal(details.firstElementChild.textContent, `Passing checks${NBSP}(12)`);
  assert.equal(details.querySelectorAll('.passing-group').length, 0);
  assert.equal(details.querySelector('.passing-note').textContent, en.passingLegacy.message);
  assert.ok(view.querySelectorAll('details.finding').length === 4 && view.querySelector('.prompt-box'), 'the rest of the result view is rendered');
});

test('when the service counted more passing checks than were kept, the heading gives both numbers and the note comes first', async () => {
  const many = entry('security-completed.json', Date.UTC(2026, 8, 25, 10));
  many.model.passingChecks = 340;
  many.model.passingItems = Array.from({ length: 300 }, (_, index) => ({ id: index % 2 ? `ok.tls.c${index}` : `ok.custom.c${index}`, title: `Check ${index}`, evidence: `evidence ${index}` }));
  const { view } = await openPopup({ result: many });
  assert.ok(view.querySelector('.score-meta').textContent.includes('340 passing checks'));
  const details = view.querySelector('details.passing-section');
  assert.equal(details.open, false);
  assert.equal(details.firstElementChild.textContent, `Passing checks${NBSP}(300${NBSP}of${NBSP}340)`, 'the closed heading agrees with the count under the score');
  assert.deepEqual(details.querySelectorAll('h4').map((h) => h.textContent), [`TLS / certificate${NBSP}(150)`, `Other checks${NBSP}(150)`]);
  assert.deepEqual(details.children.slice(0, 3).map((child) => child.className), ['section-title passing-summary', 'small muted passing-note', 'passing-group'], 'the note comes right after the heading, before the checks');
  assert.equal(details.querySelector('.passing-note').textContent, '40 more passing check(s) were counted but not kept with this result, so they are not listed here.');
});

// The arrows of the disclosures are drawn with CSS: their glyph must not become part
// of the heading's accessible name (Chrome reads generated content), and the content
// of a section starts under its heading text, after the arrow.
test('the disclosure arrows have empty alternative text and the section content lines up with the heading text', () => {
  const css = readFileSync(new URL('../src/popup/popup.css', import.meta.url), 'utf8');
  const arrows = [...css.matchAll(/([^{}]*summary::before)\s*\{([^}]*)\}/g)].filter(([, , body]) => /content:/.test(body));
  assert.deepEqual(arrows.map(([, selector]) => selector.trim().split('\n').at(-1)), ['.finding summary::before', '.finding[open] summary::before', '.toggle-section summary::before']);
  for (const [, selector, body] of arrows) assert.match(body, /content:\s*"\\25B[8E]"\s*\/\s*""\s*;/, `${selector.trim()}: the glyph has empty alternative text`);

  const px = (pattern) => Number(pattern.exec(css)?.[1]);
  const arrowWidth = px(/\.toggle-section summary::before \{[^}]*\bwidth: (\d+)px/);
  const gap = px(/\.toggle-section summary \{[^}]*\bgap: (\d+)px/);
  const indent = px(/\.toggle-section > :not\(summary\) \{ margin-left: (\d+)px; \}/);
  assert.equal(indent, arrowWidth + gap, 'every child of a section but its heading is indented by the arrow and the gap');
  assert.doesNotMatch(css, /\.(?:passing-group|passing-note|passing-list|nm-section|nm-list)[^{}]*\{[^}]*margin-left/, 'no section sets its own left indent');
  assert.match(css, /\.passing-group \{ margin-bottom: 8px;/, 'the passing groups keep only their bottom margin');
});

test('the passing checks follow the translation shown and the report language of the result', async () => {
  const cases = {
    tr: [`Başarılı kontroller${NBSP}(29)`, `DNS duruşu${NBSP}(1)`, 'DNS çözümü başarılı'],
    ja: ['合格したチェック（29件）', 'DNS状態（1件）', 'DNS resolution successful']
  };
  for (const [folder, [title, group, first]] of Object.entries(cases)) {
    const fixtureName = folder === 'tr' ? 'security-partial-redirects-tr.json' : 'security-partial-redirects.json';
    const { view } = await openPopup({ folder, language: folder, result: entry(fixtureName, Date.UTC(2026, 8, 25, 10), folder) });
    const details = view.querySelector('details.passing-section');
    assert.equal(details.open, false, folder);
    assert.equal(details.firstElementChild.textContent, title, folder);
    assert.equal(details.querySelector('h4').textContent, group, folder);
    assert.equal(details.querySelector('.passing-title').textContent, first, `${folder}: the check reads as the service reported it`);
  }
});

// Sitelemetry saves no report of an audit run through the general /mcp endpoint, so
// the notes under the findings say what the list and the result leave out, and no
// text points to a report in the app. The report link is shown only when the
// service sends one.
const withFindings = (count, total, fields = () => ({})) => {
  const result = entry('security-completed.json', Date.UTC(2026, 8, 25, 10));
  const severities = ['critical', 'high', 'medium', 'low', 'info'];
  result.model.findings = Array.from({ length: count }, (_, index) => normalizeFinding({ severity: severities[index % severities.length], title: `Issue ${index + 1}`, ...fields(index) }, index));
  result.model.total = total;
  result.model.returnedFindings = count;
  result.model.truncated = total > count;
  return result;
};
const notes = (view) => view.querySelectorAll('p.findings-note').map((note) => note.textContent);
const reportLinks = (view) => view.querySelectorAll('a').filter((a) => a.textContent === en.openReport.message);

test('the notes under the findings name what the list and the result leave out, never a report in the app', async () => {
  // More stored findings than the list shows, and more counted than were sent.
  let { view } = await openPopup({ result: withFindings(14, 20) });
  assert.equal(view.querySelectorAll('details.finding').length, 10);
  assert.deepEqual(notes(view), [
    '4 more finding(s) of this result are not shown in this list; the AI fix prompt includes them.',
    'Sitelemetry counted 6 more finding(s) that are not included in this result.'
  ]);
  const card = view.querySelector('section.result');
  assert.ok(card.children.indexOf(card.querySelector('p.findings-note')) > card.children.indexOf(card.querySelectorAll('details.finding').at(-1)), 'the notes follow the list');
  assert.equal(reportLinks(view).length, 0, 'no report link without a link from the service');
  assert.doesNotMatch(card.textContent, /full report|in the app/);

  // Findings counted but none sent: no empty list and no "no findings" text.
  ({ view } = await openPopup({ result: withFindings(0, 3) }));
  assert.equal(view.querySelector('details.finding'), null);
  assert.ok(!view.querySelector('section.result').textContent.includes(en.noFindings.message), 'a result with counted findings is not called finding-free');
  assert.ok(!view.querySelectorAll('h3').some((h) => h.textContent === en.topFindingsTitle.message));
  assert.deepEqual(notes(view), ['Sitelemetry counted 3 finding(s) that are not included in this result.']);

  // So many long findings that the prompt leaves the least severe out: the note
  // does not promise them in the prompt.
  ({ view } = await openPopup({ result: withFindings(400, 400, (index) => ({ title: `Issue ${index + 1} ${'t'.repeat(200)}`, evidence: 'e'.repeat(1000) })) }));
  assert.deepEqual(notes(view), ['390 more finding(s) of this result are not shown in this list.']);

  // Every stored finding is listed and none is missing: no note; a finding-free
  // result keeps its text.
  ({ view } = await openPopup({ result: entry('security-completed.json', Date.UTC(2026, 8, 25, 10)) }));
  assert.equal(view.querySelectorAll('details.finding').length, 4);
  assert.deepEqual(notes(view), []);
  ({ view } = await openPopup({ result: withFindings(0, 0) }));
  assert.deepEqual(notes(view), []);
  assert.ok(view.querySelector('section.result').textContent.includes(en.noFindings.message));
});

test('the findings notes follow the translation shown', async () => {
  const cases = {
    tr: ['Bu sonucun 4 bulgusu daha bu listede gösterilmiyor; AI düzeltme promptu bunları da içerir.', 'Sitelemetry 6 bulgu daha saydı; bunlar bu sonuca dahil değil.'],
    ja: ['この結果には、この一覧に表示されていない検出事項がほかに 4 件あります。AI修正プロンプトにはそれらも含まれます。', 'Sitelemetry はほかに 6 件の検出事項を集計しましたが、それらはこの結果に含まれていません。']
  };
  for (const [folder, expected] of Object.entries(cases)) {
    const { view } = await openPopup({ folder, language: folder, result: withFindings(14, 20) });
    assert.deepEqual(notes(view), expected, folder);
  }
});

test('the report link appears only when the service sends one', async () => {
  const linked = entry('security-completed.json', Date.UTC(2026, 8, 25, 10));
  linked.model.reportUrl = 'https://sitelemetry.com/app/reports/r_1';
  let { view } = await openPopup({ result: linked });
  const [link] = reportLinks(view);
  assert.ok(link, 'the link is shown with the URL the service sent');
  assert.equal(link.getAttribute('href'), 'https://sitelemetry.com/app/reports/r_1');

  // The general /mcp endpoint sends no report URL, so a result it returns has none.
  const plain = entry('security-partial-redirects.json', Date.UTC(2026, 8, 25, 10));
  assert.equal(plain.model.reportUrl, null);
  ({ view } = await openPopup({ result: plain }));
  assert.equal(reportLinks(view).length, 0);
});
