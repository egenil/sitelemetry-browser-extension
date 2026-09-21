#!/usr/bin/env node
// Validates manifest.json against the rules this extension commits to: Manifest V3,
// the exact permission set, the single host permission, a strict CSP, no content
// scripts, existing files and valid PNG icons of the declared sizes.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const EXPECTED_PERMISSIONS = ['activeTab', 'storage', 'alarms'];
export const EXPECTED_HOSTS = ['https://sitelemetry.com/*'];
const FORBIDDEN_KEYS = ['content_scripts', 'web_accessible_resources', 'optional_permissions', 'optional_host_permissions', 'externally_connectable', 'sandbox', 'declarative_net_request', 'oauth2'];

export function readPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('IHDR missing');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let offset = 8;
  const idat = [];
  let sawEnd = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') sawEnd = true;
    offset += 12 + length;
  }
  if (!sawEnd) throw new Error('IEND missing');
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (channels && raw.length !== (width * channels + 1) * height) throw new Error('unexpected pixel data length');
  return { width, height, colorType };
}

export function validateManifest(root) {
  const errors = [];
  const warnings = [];
  const file = join(root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { errors: [`manifest.json cannot be parsed: ${error.message}`], warnings, manifest: null };
  }
  const fileExists = (relative) => existsSync(join(root, relative));

  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  if (!/^\d+(\.\d+){1,3}$/.test(String(manifest.version))) errors.push('version must be 1 to 4 dot-separated integers');
  const versionFile = join(root, 'src/shared/version.js');
  if (existsSync(versionFile) && !readFileSync(versionFile, 'utf8').includes(`'${manifest.version}'`)) errors.push('src/shared/version.js does not match manifest.version');

  // Localised name and description.
  if (!manifest.default_locale) errors.push('default_locale is required when __MSG_ keys are used');
  let messages = {};
  const messagesFile = join(root, '_locales', manifest.default_locale || 'en', 'messages.json');
  if (!existsSync(messagesFile)) errors.push(`${messagesFile} is missing`);
  else messages = JSON.parse(readFileSync(messagesFile, 'utf8'));
  const resolve = (value, field) => {
    const match = /^__MSG_(\w+)__$/.exec(String(value));
    if (!match) return String(value);
    if (!messages[match[1]]?.message) errors.push(`${field} references missing message ${match[1]}`);
    return messages[match[1]]?.message || '';
  };
  const name = resolve(manifest.name, 'name');
  const description = resolve(manifest.description, 'description');
  if (!name || name.length > 75) errors.push('name must be 1 to 75 characters');
  if (!description) errors.push('description is required');
  else if (description.length > 132) errors.push(`description is ${description.length} characters; the limit is 132`);
  if (manifest.action?.default_title) resolve(manifest.action.default_title, 'action.default_title');

  // Permissions: exactly the expected set, no more.
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const missing = EXPECTED_PERMISSIONS.filter((p) => !permissions.includes(p));
  const extra = permissions.filter((p) => !EXPECTED_PERMISSIONS.includes(p));
  if (missing.length) errors.push(`permissions missing: ${missing.join(', ')}`);
  if (extra.length) errors.push(`permissions not allowed: ${extra.join(', ')}`);
  const hosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  if (JSON.stringify(hosts) !== JSON.stringify(EXPECTED_HOSTS)) errors.push(`host_permissions must be exactly ${JSON.stringify(EXPECTED_HOSTS)}`);
  for (const key of FORBIDDEN_KEYS) if (key in manifest) errors.push(`${key} must not be declared`);

  // Content security policy.
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp !== 'string') errors.push('content_security_policy.extension_pages is required');
  else {
    const directives = Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...v] = d.split(/\s+/); return [n, v]; }));
    if (JSON.stringify(directives['script-src']) !== JSON.stringify(["'self'"])) errors.push("script-src must be exactly 'self'");
    if (JSON.stringify(directives['object-src']) !== JSON.stringify(["'none'"])) errors.push("object-src must be exactly 'none'");
    if (!directives['default-src'] || directives['default-src'][0] !== "'none'") errors.push("default-src must be 'none'");
    if (/unsafe-eval|unsafe-inline|wasm-unsafe-eval|http:|https:\/\//.test(csp)) errors.push('CSP must not allow unsafe-eval, unsafe-inline, wasm or remote script sources');
    for (const directive of ['style-src', 'img-src']) {
      if (!directives[directive] || directives[directive].some((v) => v !== "'self'")) errors.push(`${directive} must be exactly 'self'`);
    }
    if (!directives['connect-src'] || directives['connect-src'].some((v) => !/^https:/.test(v))) errors.push('connect-src must allow https only');
  }

  // Referenced files.
  if (manifest.background?.service_worker) {
    if (!fileExists(manifest.background.service_worker)) errors.push(`service worker ${manifest.background.service_worker} is missing`);
    if (manifest.background.type !== 'module') errors.push('background.type must be "module"');
  } else errors.push('background.service_worker is required');
  if (!manifest.action?.default_popup) errors.push('action.default_popup is required');
  else if (!fileExists(manifest.action.default_popup)) errors.push(`popup ${manifest.action.default_popup} is missing`);
  if (!manifest.options_ui?.page) errors.push('options_ui.page is required');
  else if (!fileExists(manifest.options_ui.page)) errors.push(`options page ${manifest.options_ui.page} is missing`);

  // Icons.
  const iconSets = [manifest.icons || {}, manifest.action?.default_icon || {}];
  for (const size of ['16', '32', '48', '128']) {
    if (!manifest.icons?.[size]) errors.push(`icons.${size} is required`);
  }
  for (const icons of iconSets) {
    for (const [size, relative] of Object.entries(icons)) {
      if (!fileExists(relative)) { errors.push(`icon ${relative} is missing`); continue; }
      try {
        const png = readPng(readFileSync(join(root, relative)));
        if (png.width !== Number(size) || png.height !== Number(size)) errors.push(`icon ${relative} is ${png.width}x${png.height}, expected ${size}x${size}`);
      } catch (error) {
        errors.push(`icon ${relative} is not a valid PNG: ${error.message}`);
      }
    }
  }
  if (!manifest.minimum_chrome_version) warnings.push('minimum_chrome_version is not set');
  return { errors, warnings, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url)));
  const { errors, warnings } = validateManifest(root);
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length) process.exit(1);
  console.log(`manifest.json is valid (${EXPECTED_PERMISSIONS.join(', ')}; hosts ${EXPECTED_HOSTS.join(', ')}).`);
}
