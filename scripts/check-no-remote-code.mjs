#!/usr/bin/env node
// Static check that the extension loads no remote code and uses no dynamic code
// execution: every script and stylesheet is a relative file, no inline scripts or
// handlers, no eval-style constructs, no HTML injection helpers, and the only
// hard-coded network hosts are sitelemetry.com.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_DIRS = ['src', '_locales'];
const SCAN_FILES = ['manifest.json'];
const ALLOWED_HOSTS = ['sitelemetry.com'];

const JS_RULES = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bimport\s*\(\s*['"`]https?:/, 'dynamic import of a remote module'],
  [/\bfrom\s*['"]https?:/, 'static import of a remote module'],
  [/\bdocument\.write\s*\(/, 'document.write()'],
  [/\.(?:innerHTML|outerHTML)\s*=/, 'innerHTML/outerHTML assignment'],
  [/\.insertAdjacentHTML\s*\(/, 'insertAdjacentHTML()'],
  [/\bsetTimeout\s*\(\s*['"`]/, 'setTimeout with a string'],
  [/\bsetInterval\s*\(\s*['"`]/, 'setInterval with a string'],
  [/\bchrome\.storage\.sync\b/, 'chrome.storage.sync (the key must stay local)'],
  [/\bconsole\.\w+\([^)]*apiKey/, 'logging the API key']
];
const HTML_RULES = [
  [/<script\b(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i, 'inline script body'],
  [/<script\b[^>]*\bsrc=["'](?:https?:)?\/\//i, 'remote script'],
  [/<script\b(?![^>]*type=["']module["'])[^>]*>/i, 'script without type="module"'],
  [/<link\b[^>]*\bhref=["'](?:https?:)?\/\//i, 'remote stylesheet or resource'],
  [/<(?:iframe|object|embed)\b/i, 'embedded frame or plugin'],
  [/\son[a-z]+\s*=/i, 'inline event handler'],
  [/\bhref=["']javascript:/i, 'javascript: URL'],
  [/<style\b/i, 'inline <style> element (blocked by the CSP)'],
  [/\sstyle=["']/i, 'inline style attribute (blocked by the CSP)'],
  [/<img\b[^>]*\bsrc=["'](?:https?:)?\/\//i, 'remote image']
];
const CSS_RULES = [
  [/@import\s+(?:url\()?['"]?https?:/i, 'remote @import'],
  [/url\(\s*['"]?(?:https?:)?\/\//i, 'remote url()']
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function checkHosts(text, file, errors) {
  for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    const host = match[1].toLowerCase();
    if (ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) continue;
    if (host === 'www.w3.org') continue; // SVG namespace in markup
    errors.push(`${file}: references host ${host}`);
  }
}

export function scan(root) {
  const errors = [];
  const files = [...SCAN_FILES.map((f) => join(root, f)), ...SCAN_DIRS.flatMap((d) => [...walk(join(root, d))])];
  for (const path of files) {
    const file = relative(root, path).replaceAll('\\', '/');
    const text = readFileSync(path, 'utf8');
    const ext = extname(path);
    const rules = ext === '.js' || ext === '.mjs' ? JS_RULES : ext === '.html' ? HTML_RULES : ext === '.css' ? CSS_RULES : [];
    for (const [pattern, label] of rules) if (pattern.test(text)) errors.push(`${file}: ${label}`);
    if (ext === '.html') {
      for (const match of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        if (/^(?:[a-z]+:)?\/\//i.test(match[1])) errors.push(`${file}: script src ${match[1]} is not a packaged file`);
      }
    }
    if (ext !== '.json' || file === 'manifest.json') checkHosts(text, file, errors);
  }
  return { errors, files: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url)));
  const { errors, files } = scan(root);
  for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length) process.exit(1);
  console.log(`No remote code or dynamic execution found in ${files} files.`);
}
