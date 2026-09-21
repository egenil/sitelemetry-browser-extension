import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator, formatMessage, setFallbackMessages, t } from '../src/shared/i18n.js';
import { SEVERITIES } from '../src/shared/outcome.js';

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
    for (const match of text.matchAll(/'((?:kind|status)[A-Z][A-Za-z]+)'/g)) used.add(match[1]);
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
