import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_LANGUAGES, createTranslator, formatMessage, localizeDocument, reportLanguage, setFallbackMessages, t, uiLanguage } from '../src/shared/i18n.js';
import { SEVERITIES } from '../src/shared/outcome.js';
import { CHROME_LOCALES } from '../scripts/validate-manifest.mjs';
import { APP_WORDS, REPORT_OR_APP, REPORT_WORDS } from './report-words.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const messages = JSON.parse(readFileSync(join(root, '_locales/en/messages.json'), 'utf8'));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
const sources = [...walk(join(root, 'src'))].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

test('formatMessage follows the chrome.i18n placeholder rules', () => {
  const entry = { message: 'Hello $NAME$, $$ $COUNT$ $Missing$', placeholders: { name: { content: '$1' }, count: { content: '$2 items' } } };
  assert.equal(formatMessage(entry, ['Ada', 3]), 'Hello Ada, $ 3 items $Missing$');
  assert.equal(formatMessage(entry, 'Solo'), 'Hello Solo, $  items $Missing$');
  assert.equal(formatMessage({ message: 'plain' }), 'plain');
  const translate = createTranslator({ greeting: { message: 'Hi $WHO$', placeholders: { who: { content: '$1' } } } });
  assert.equal(translate('greeting', ['there']), 'Hi there');
  assert.equal(translate('missing'), 'missing');
  setFallbackMessages(messages);
  assert.equal(t('jobLabel', ['mj_1']), 'Job mj_1');
  assert.equal(t('noSuchKey'), 'noSuchKey');
  setFallbackMessages(null);
});

test('every message has text, valid placeholders and is referenced by the extension', () => {
  const allSource = sources.map((s) => s.text).join('\n') + readFileSync(join(root, 'manifest.json'), 'utf8');
  for (const [key, entry] of Object.entries(messages)) {
    assert.match(key, /^[A-Za-z][A-Za-z0-9_]*$/, `key ${key} is not a valid chrome.i18n name`);
    assert.ok(typeof entry.message === 'string' && entry.message.trim(), `${key} has no message`);
    assert.ok(typeof entry.description === 'string' && entry.description.trim(), `${key} has no translator description`);
    const used = new Set([...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1].toLowerCase()));
    const declared = new Set(Object.keys(entry.placeholders || {}).map((name) => name.toLowerCase()));
    assert.deepEqual([...used].sort(), [...declared].sort(), `${key} placeholders do not match`);
    for (const placeholder of Object.values(entry.placeholders || {})) assert.match(placeholder.content, /^\$\d$|^\$\d /, `${key} placeholder content must reference a substitution`);
    const prefixMatch = /^(severity|startError|kind|status|nm)/.exec(key);
    const referenced = allSource.includes(`'${key}'`) || allSource.includes(`"${key}"`) || allSource.includes(`__MSG_${key}__`) || (prefixMatch && allSource.includes(`${prefixMatch[1]}_$`)) || allSource.includes(`'${key}`);
    assert.ok(referenced, `${key} is defined but never used`);
  }
});

test('every key the extension uses is defined in the default locale', () => {
  const used = new Set();
  for (const { text } of sources) {
    for (const match of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(match[1]);
    for (const match of text.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) used.add(match[1]);
    for (const match of text.matchAll(/push\('(nm[A-Za-z]+)'/g)) used.add(match[1]);
    for (const match of text.matchAll(/'((?:kind|status|module|explain|nm)[A-Z][A-Za-z]+)'/g)) used.add(match[1]);
  }
  for (const severity of SEVERITIES) used.add(`severity_${severity}`);
  for (const code of ['unsupported_origin', 'unsupported_kind', 'no_api_key', 'not_acknowledged', 'unknown']) used.add(`startError_${code}`);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  for (const value of [manifest.name, manifest.description, manifest.action?.default_title]) {
    const match = /^__MSG_(\w+)__$/.exec(String(value));
    if (match) used.add(match[1]);
  }
  const missing = [...used].filter((key) => !messages[key]);
  assert.deepEqual(missing, [], 'keys used without a message');
  assert.ok(used.size > 80, `only ${used.size} keys were detected; the extraction may be broken`);
});

test('the manifest description fits the store limit', () => {
  assert.ok(messages.extensionDescription.message.length <= 132, `${messages.extensionDescription.message.length} characters`);
});

const folders = readdirSync(join(root, '_locales')).sort();
const load = (folder) => JSON.parse(readFileSync(join(root, '_locales', folder, 'messages.json'), 'utf8'));
const placeholdersIn = (text) => [...String(text).matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1].toLowerCase()).sort();
// Chrome's lookup for a UI language: the exact locale, then the language alone, then default_locale.
function resolveFolder(tag) {
  const exact = tag.replace('-', '_');
  const [language] = exact.split('_');
  return [exact, language].find((name) => folders.includes(name)) || 'en';
}

test('the extension ships all nine Sitelemetry languages under valid Chrome locale folders', () => {
  assert.deepEqual(folders, ['de', 'en', 'es', 'fr', 'it', 'ja', 'pt_BR', 'pt_PT', 'tr', 'zh_CN']);
  for (const folder of folders) assert.ok(CHROME_LOCALES.includes(folder), `${folder} is not a Chrome locale`);
  const languages = new Set(folders.map((folder) => reportLanguage(load(folder).uiLanguageTag.message)));
  assert.deepEqual([...languages].sort(), [...REPORT_LANGUAGES].sort());
});

test('every locale translates every key with the same placeholders and no empty message', () => {
  const keys = Object.keys(messages);
  for (const folder of folders) {
    const locale = load(folder);
    assert.deepEqual(Object.keys(locale), keys, `${folder} has other keys or another order than en`);
    for (const key of keys) {
      const entry = locale[key];
      assert.ok(typeof entry.message === 'string' && entry.message.trim(), `${folder}/${key} is empty`);
      assert.equal(entry.description, messages[key].description, `${folder}/${key} keeps the translator description`);
      assert.deepEqual(entry.placeholders || null, messages[key].placeholders || null, `${folder}/${key} placeholders`);
      assert.deepEqual(placeholdersIn(entry.message), placeholdersIn(messages[key].message), `${folder}/${key} uses other placeholders`);
      assert.doesNotMatch(entry.message.replace(/\$\$/g, '').replace(/\$[A-Za-z0-9_@]+\$/g, ''), /\$/, `${folder}/${key} has an unescaped $`);
    }
    assert.ok(locale.extensionDescription.message.length <= 132, `${folder} description: ${locale.extensionDescription.message.length} characters`);
    assert.ok(locale.extensionName.message.length <= 75);
    assert.equal(locale.uiLanguageTag.message, folder.replace('_', '-'), `${folder} names its own language tag`);
  }
  // Portuguese is one translation (as on sitelemetry.com), shipped for both Chrome locales.
  const [brazil, portugal] = [load('pt_BR'), load('pt_PT')];
  for (const key of Object.keys(messages).filter((name) => name !== 'uiLanguageTag')) assert.equal(portugal[key].message, brazil[key].message, key);
});

test('translations name the same buttons they refer to', () => {
  for (const folder of folders.filter((name) => name !== 'en')) {
    const locale = load(folder);
    const check = locale.checkAgainButton.message;
    for (const key of ['errorTimeoutJob', 'errorTransportJob']) assert.ok(locale[key].message.includes(check), `${folder}/${key} names ${check}`);
    assert.ok(locale.privacyItemSent.message.includes(locale.auditButton.message), `${folder}/privacyItemSent names the audit button`);
    assert.ok(locale.privacyItemPrompt.message.includes(locale.fixPromptButton.message), `${folder}/privacyItemPrompt names the prompt button`);
  }
});

// "What was not measured" describes a check without a result, never a failure of
// Sitelemetry: no "could not" forms in these texts, in any language.
const FAILURE_WORDING = Object.freeze({
  en: /could not|couldn't|failed|unable/i,
  tr: /[ae]m[ae]d[ıi]|[ae]m[ıi]yor|başarısız/i,
  es: /no se pud|no pud|fall[óo]/i,
  de: /konnte|fehlgeschlagen/i,
  fr: /n’a pas pu|impossible|échou/i,
  pt_BR: /não foi possível|não pôde|falh/i,
  pt_PT: /não foi possível|não pôde|falh/i,
  it: /non è stato possibile|impossibile|non ha potuto|fallit/i,
  ja: /できません|できなかった|失敗/,
  zh_CN: /未能|无法|失败/
});

test('no "not measured" text reads as a failure', () => {
  assert.deepEqual(Object.keys(FAILURE_WORDING).sort(), folders);
  for (const folder of folders) {
    for (const [key, entry] of Object.entries(load(folder))) {
      if (/^(notMeasured|nm|explain)/.test(key)) assert.doesNotMatch(entry.message, FAILURE_WORDING[folder], `${folder}/${key}`);
    }
  }
});

// Sitelemetry saves no report of an audit run through the general /mcp endpoint the
// extension uses, so no message may send the user to one in the app. The words for
// "report" and "app" appear only in the messages listed here, never together: the
// app for the account, the verification, the terms and the API key; the report
// language; "reported" by the audit; and the label of the report link, which the
// popup shows only when the service sends a link (see test/popup.test.mjs). The
// notes about findings, measurements or results that are not listed, and the job
// errors, name neither.
const APP_KEYS = Object.freeze(['stepVerifyOwnership', 'stepAcceptTerms', 'apiKeyHelp', 'getKeyLink']);
const REPORT_KEYS = Object.freeze(['openReport', 'sentNote', 'privacyItemSent', 'noFindings', 'nmReasonDetail']);
const NOTE_KEYS = Object.freeze([
  'moreFindings', 'moreFindingsNotShown', 'findingsNotIncluded', 'findingsNoneIncluded', 'nmUnknown',
  'passingMore', 'passingNotListed', 'passingLegacy', 'errorTimeoutJob', 'errorTransportJob', 'errorInterrupted'
]);

test('no message refers to a report in the Sitelemetry app', () => {
  assert.deepEqual(Object.keys(REPORT_WORDS).sort(), folders);
  for (const folder of folders) {
    const locale = load(folder);
    for (const [key, entry] of Object.entries(locale)) {
      const report = REPORT_WORDS[folder].test(entry.message);
      const app = APP_WORDS[folder].test(entry.message);
      assert.ok(!(report && app), `${folder}/${key} names a report and the app: ${entry.message}`);
      if (report) assert.ok(REPORT_KEYS.includes(key), `${folder}/${key} names a report: ${entry.message}`);
      if (app) assert.ok(APP_KEYS.includes(key), `${folder}/${key} names the app: ${entry.message}`);
    }
    for (const key of NOTE_KEYS) assert.doesNotMatch(locale[key].message, REPORT_OR_APP[folder], `${folder}/${key}`);
  }
  // The job errors still name the button that retrieves the result.
  assert.match(messages.errorTimeoutJob.message, /choose Check again to retrieve its result\.$/);
  assert.match(messages.errorTransportJob.message, /choose Check again to retrieve its result\.$/);
});

test('the notes about findings that are not listed read as facts, not failures', () => {
  for (const folder of folders) {
    const locale = load(folder);
    for (const key of ['moreFindings', 'moreFindingsNotShown', 'findingsNotIncluded', 'findingsNoneIncluded', 'nmUnknown']) {
      assert.doesNotMatch(locale[key].message, FAILURE_WORDING[folder], `${folder}/${key}`);
    }
    // The prompt the note names is the one of the copy button.
    const prompt = locale.fixPromptTextLabel.message.toLocaleLowerCase(locale.uiLanguageTag.message);
    assert.ok(locale.moreFindings.message.toLocaleLowerCase(locale.uiLanguageTag.message).includes(prompt), `${folder}/moreFindings names ${prompt}`);
  }
});

test('French keeps no-break spaces before high punctuation and inside guillemets', () => {
  for (const [key, entry] of Object.entries(load('fr'))) {
    assert.doesNotMatch(entry.message, / [:;?!»]|« /, `fr/${key}: a line could start with the sign`);
  }
});

test('the report language follows the UI language and matches the translation Chrome shows', () => {
  assert.equal(reportLanguage('tr'), 'tr');
  assert.equal(reportLanguage('pt-BR'), 'pt');
  assert.equal(reportLanguage('pt_PT'), 'pt');
  assert.equal(reportLanguage('es-419'), 'es');
  assert.equal(reportLanguage('zh-CN'), 'zh');
  assert.equal(reportLanguage('ZH-cn'), 'zh');
  assert.equal(reportLanguage('zh-TW'), 'en', 'only Simplified Chinese is shipped');
  assert.equal(reportLanguage('zh-Hant-HK'), 'en');
  assert.equal(reportLanguage('ko'), 'en');
  assert.equal(reportLanguage(''), 'en');
  assert.equal(reportLanguage(undefined), 'en');
  assert.equal(reportLanguage('tr;DROP'), 'en');
  // Whatever UI language Chrome reports, the report language is the one of the
  // translation the popup is shown in, so the service's reasons read like the popup.
  for (const tag of ['en-US', 'en-GB', 'tr', 'es', 'es-419', 'de', 'fr', 'fr-CA', 'pt-BR', 'pt-PT', 'it', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ru', 'nl']) {
    assert.equal(reportLanguage(load(resolveFolder(tag)).uiLanguageTag.message), reportLanguage(tag), tag);
  }
});

test('the Node fallback renders any shipped language and falls back to English per key', () => {
  const tr = load('tr');
  setFallbackMessages(tr, { defaults: messages, language: 'tr' });
  try {
    assert.equal(t('auditButton'), 'Bu siteyi denetle');
    assert.equal(t('findingsSummary', [3]), '3 bulgu');
    assert.equal(uiLanguage(), 'tr');
    const root = { documentElement: {}, querySelectorAll: () => [] };
    localizeDocument(root);
    assert.equal(root.documentElement.lang, 'tr');
    setFallbackMessages({ auditButton: tr.auditButton }, { defaults: messages, language: 'tr' });
    assert.equal(t('auditAgainButton'), 'Audit again', 'a key missing from the locale falls back to English');
    const translate = createTranslator(load('ja'), messages);
    assert.equal(translate('nmNotMeasured'), '未測定');
    assert.equal(createTranslator({}, messages)('nmNotMeasured'), 'not measured');
  } finally {
    setFallbackMessages(null);
  }
  assert.equal(uiLanguage(), 'en');
});
