# Changelog

## 0.1.1 - 2026-09-25

- Popup: **Copy AI fix prompt** on a completed or partial result. The extension builds a plain-text prompt from the stored result on the device (site origin, audit date, score and grade, coverage, severity counts, passing checks, every stored finding with severity, title, location, evidence, impact and the suggested fix, most severe first, the "not measured" entries and the task for the assistant) and copies it to the clipboard. The same text can be opened in a read-only field and copied by hand when the clipboard is unavailable. Finding text is marked as data and neutralized: line breaks, delimiter lookalikes and invisible characters (zero-width, bidi, Unicode Tag characters, variation selectors) are removed, so it cannot imitate the prompt's delimiters or task section or carry hidden text. The prompt never contains the API key, job ids, poll arguments or service links, and stays within 30,000 characters: long fields are shortened first, and for a very large result the least severe findings are left out with a note that says how many and that the full report in the Sitelemetry app lists them. A result whose findings were not stored asks the assistant to request them rather than giving generic advice; a partial result without findings is not described as issue-free. No new permission and no network request.
- Running view: the phase line is always the extension's own text ("Starting the audit…", "The audit is running on Sitelemetry. Results appear here automatically.", or the busy-account note). The service's running answer, which is written for MCP clients, is no longer stored with the job or shown.
- HTTP 403 is reported as "Sitelemetry refused this request (HTTP 403)." with the service's own message, if its JSON error body has one, under "Message from Sitelemetry"; only HTTP 401 is described as a rejected API key. The settings page **Test connection** makes the same distinction. A 403 result stored by 0.1.0 is shown with the new wording, and a non-JSON body (for example a proxy page) answering 401 is no longer shown as a message from Sitelemetry.
- Running view: resuming a stalled job with **Check again** no longer shows the busy-account note left over from the earlier attempt.
- Popup: copying the prompt updates the status line in place, so keyboard focus stays on the button and screen readers announce the result; storage updates for other sites no longer rebuild the result view.
- Developer harness: a `forbidden` scenario.

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
