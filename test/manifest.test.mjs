import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_HOSTS, EXPECTED_PERMISSIONS, readPng, validateManifest } from '../scripts/validate-manifest.mjs';
import { scan } from '../scripts/check-no-remote-code.mjs';
import { SIZES, encodePng, renderIcon } from '../scripts/make-icons.mjs';
import { EXTENSION_VERSION } from '../src/shared/version.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('manifest.json is Manifest V3 with the minimal permission set and a strict CSP', () => {
  const { errors, warnings } = validateManifest(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), [...EXPECTED_PERMISSIONS].sort());
  assert.deepEqual(manifest.host_permissions, EXPECTED_HOSTS);
  assert.equal(manifest.content_security_policy.extension_pages,
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https:; object-src 'none'; base-uri 'none'; form-action 'none'");
  assert.equal('content_scripts' in manifest, false);
  assert.equal('optional_host_permissions' in manifest, false);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.version, EXTENSION_VERSION);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, manifest.version);
});

test('the validator rejects a manifest that drifts from the rules', () => {
  const dir = mkdtempSync(join(root, 'test', 'tmp-manifest-'));
  try {
    for (const folder of ['icons', 'src', '_locales']) cpSync(join(root, folder), join(dir, folder), { recursive: true });
    const drifted = {
      ...manifest,
      permissions: [...manifest.permissions, 'tabs'],
      host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }],
      content_security_policy: { extension_pages: "script-src 'self' https://cdn.example; object-src 'self'" }
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(drifted));
    const { errors } = validateManifest(dir);
    assert.ok(errors.some((e) => /permissions not allowed: tabs/.test(e)), errors.join('\n'));
    assert.ok(errors.some((e) => /host_permissions must be exactly/.test(e)));
    assert.ok(errors.some((e) => /content_scripts must not be declared/.test(e)));
    assert.ok(errors.some((e) => /script-src must be exactly 'self'/.test(e)));
    assert.ok(errors.some((e) => /object-src must be exactly 'none'/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no file loads remote code or uses dynamic execution', () => {
  const { errors, files } = scan(root);
  assert.deepEqual(errors, []);
  assert.ok(files >= 15);
  const html = readFileSync(join(root, 'src/popup/popup.html'), 'utf8');
  assert.match(html, /<script type="module" src="popup\.js"><\/script>/);

  const dir = mkdtempSync(join(root, 'test', 'tmp-remote-'));
  try {
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, '_locales'), join(dir, '_locales'), { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}');
    writeFileSync(join(dir, 'src', 'bad.html'), '<script src="https://cdn.example/x.js"></script><button onclick="go()">x</button>');
    writeFileSync(join(dir, 'src', 'bad.js'), "const f = new Function('return 1'); document.body.innerHTML = '<b>x</b>'; fetch('https://tracker.example/x');");
    writeFileSync(join(dir, 'src', 'bad.css'), '@import url("https://fonts.example/x.css");');
    const bad = scan(dir).errors;
    for (const expected of ['remote script', 'inline event handler', 'new Function()', 'innerHTML/outerHTML assignment', 'references host tracker.example', 'remote @import']) {
      assert.ok(bad.some((e) => e.includes(expected)), `expected "${expected}" in ${bad.join('\n')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('icons are valid PNGs of the declared sizes and the encoder round-trips', () => {
  for (const size of SIZES) {
    const png = readPng(readFileSync(join(root, `icons/icon${size}.png`)));
    assert.deepEqual(png, { width: size, height: size, colorType: 6 });
  }
  const rendered = renderIcon(16);
  const decoded = readPng(encodePng(16, 16, rendered));
  assert.deepEqual(decoded, { width: 16, height: 16, colorType: 6 });
  let opaque = 0;
  for (let i = 3; i < rendered.length; i += 4) if (rendered[i] === 255) opaque += 1;
  assert.ok(opaque > 100, 'the icon has an opaque body');
  assert.ok(rendered[3] < 255, 'the 16px corner is anti-aliased');
  assert.equal(renderIcon(128)[3], 0, 'the 128px corner is transparent');
  assert.throws(() => readPng(Buffer.from('not a png')), /not a PNG/);
});
