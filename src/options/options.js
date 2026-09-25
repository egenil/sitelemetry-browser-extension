// Options page: API key (chrome.storage.local only), base URL override for staging,
// connection test and the ownership acknowledgement. The key is never logged and
// never leaves this device except as the bearer token to the configured base URL.
import { localizeDocument, t } from '../shared/i18n.js';
import { APP_URL, DEFAULT_BASE_URL, SITE_URL } from '../shared/links.js';
import { createMcpClient } from '../shared/mcp-client.js';
import { getSettings, normalizeBaseUrl, saveSettings } from '../shared/storage.js';
import { connectionErrorText, formatTimestamp } from '../shared/text.js';
import { EXTENSION_VERSION } from '../shared/version.js';

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status small ${kind}`.trim();
}

function updateBaseUrlWarning() {
  let origin = DEFAULT_BASE_URL;
  try { origin = normalizeBaseUrl($('base-url').value); } catch { origin = null; }
  $('base-url-warning').hidden = origin === DEFAULT_BASE_URL;
}

async function renderAcknowledgement() {
  const settings = await getSettings();
  $('ack-status').textContent = settings.acknowledgedAt ? t('ackStatus', [formatTimestamp(settings.acknowledgedAt)]) : t('ackStatusNone');
  $('reset-ack').hidden = !settings.acknowledgedAt;
}

async function save() {
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl($('base-url').value);
  } catch {
    setStatus(t('invalidBaseUrl'), 'error');
    return false;
  }
  await saveSettings({ apiKey: $('api-key').value.trim(), baseUrl });
  $('base-url').value = baseUrl;
  updateBaseUrlWarning();
  setStatus(t('saved'), 'ok');
  return true;
}

async function testConnection() {
  const apiKey = $('api-key').value.trim();
  if (!apiKey) { setStatus(t('noKey'), 'error'); return; }
  let baseUrl;
  try { baseUrl = normalizeBaseUrl($('base-url').value); } catch { setStatus(t('invalidBaseUrl'), 'error'); return; }
  $('test').disabled = true;
  setStatus(t('testing'));
  try {
    const client = createMcpClient({ baseUrl, apiKey, requestTimeoutMs: 20_000 });
    const result = await client.initialize();
    const server = [result?.serverInfo?.name, result?.serverInfo?.version].filter(Boolean).join(' ') || client.endpoint;
    setStatus(t('testOk', [server, result?.protocolVersion || '?']), 'ok');
  } catch (error) {
    setStatus(connectionErrorText(error, t), 'error');
  } finally {
    $('test').disabled = false;
  }
}

async function main() {
  localizeDocument();
  document.title = t('optionsTitle');
  $('get-key-link').href = APP_URL;
  $('site-link').href = SITE_URL;
  $('version').textContent = t('versionLabel', [EXTENSION_VERSION]);

  const settings = await getSettings();
  $('api-key').value = settings.apiKey;
  $('base-url').value = settings.baseUrl;
  updateBaseUrlWarning();
  await renderAcknowledgement();

  $('toggle-key').addEventListener('click', () => {
    const input = $('api-key');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggle-key').textContent = reveal ? t('hideKey') : t('showKey');
  });
  $('base-url').addEventListener('input', updateBaseUrlWarning);
  $('save').addEventListener('click', save);
  $('test').addEventListener('click', testConnection);
  $('remove-key').addEventListener('click', async () => {
    $('api-key').value = '';
    await saveSettings({ apiKey: '' });
    setStatus(t('keyRemoved'), 'ok');
  });
  $('reset-ack').addEventListener('click', async () => {
    await saveSettings({ acknowledgedAt: null });
    await renderAcknowledgement();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.ownershipAcknowledgedAt) renderAcknowledgement();
  });
}

main().catch((error) => {
  setStatus(t('testFailed', [error?.message || String(error)]), 'error');
});
