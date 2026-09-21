# Changelog

## 0.1.0 - 2026-09-21

Initial release.

- Manifest V3 extension for Chrome and Microsoft Edge (one package): popup, options page, module service worker; no bundler, no dependencies, no remote code, no analytics, no content scripts.
- Options page: Sitelemetry MCP API key in `chrome.storage.local` (masked field, show/hide, remove), base URL override for staging, **Test connection** (MCP `initialize` on `{base}/mcp`), ownership acknowledgement reset, privacy summary.
- Popup: **Audit this site** for the active tab origin (`activeTab`), ownership and authorization notice with a persisted acknowledgement, security audit through the MCP contract (`audit_security`), polling with the server's `pollArguments` and `retryAfterMs`, job state persisted per origin and resumed by `chrome.alarms` when the worker is suspended, result view with score, grade, severity counts, top findings with fixes, "What was not measured", report link, verification step, and the neutral plan and usage box (`utm_source=browser-extension&utm_medium=extension`). "Sign up free" link for users without a key. A job that outlives the time budget, or whose connection fails after Sitelemetry confirmed it, is kept with its `jobId` and `pollArguments` and offered as **Check again**, which retrieves the same audit instead of using a second scan; a job whose start call was interrupted before the service confirmed it is never re-sent.
- Toolbar badge with the last score for the audited site in that tab; a finished audit badges the tab only while it still shows the audited origin.
- Strict CSP (`default-src 'none'; script-src 'self'; object-src 'none'` and friends), permissions `activeTab`, `storage`, `alarms`, host permission `https://sitelemetry.com/*` only.
- Icons 16/32/48/128 rendered by a dependency-free PNG writer (`scripts/make-icons.mjs`).
- Every user-facing string in `_locales/en/messages.json` (chrome.i18n with a Node fallback).
- Tests: node:test suite against the mock server copied from the Audit Action (client, polling, outcome classification, plan box, i18n coverage), manifest validation, no-remote-code scan, PNG validation.
- Docs: README, STORE-LISTING, PRIVACY, SUBMISSION, PACKAGING; PowerShell packaging script.
