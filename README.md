# Sitelemetry Audit browser extension

A Manifest V3 extension for Chrome and Microsoft Edge (one package for both) that runs a [Sitelemetry](https://sitelemetry.com) security audit of the website in the current tab and shows the score, the findings with their fixes, what was not measured and the plan and usage facts of the connected account.

It is a thin client: the popup asks the background service worker to call the hosted Sitelemetry MCP endpoint with your API key, the worker polls the running audit (also after the popup is closed) and stores the result for the site. No bundler, no dependencies, plain ES modules, no remote code, no analytics, no content scripts.

## Ownership and authorization

Audit only websites you own or are explicitly authorized to test. Every audit is performed by Sitelemetry against the live site and is recorded on the connected account. The popup shows this notice before the first audit and asks for an explicit acknowledgement, which is stored on the device.

## Install

Chrome: install [Sitelemetry Audit from the Chrome Web Store](https://chromewebstore.google.com/detail/sitelemetry-audit/mjnfjbacfigionnnfbgjmleddcgmnjgf).

Microsoft Edge: the Edge Add-ons listing is not published yet. Until it is, Edge can install the same extension from the Chrome Web Store link above after you turn on **Allow extensions from other stores** on `edge://extensions`.

Unpacked, for development or review:

1. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
2. **Load unpacked** and pick this directory (the one with `manifest.json`).
3. Pin the toolbar button. The settings page opens on first install.

## Get an API key

1. Sign in at <https://sitelemetry.com/app> (a Free account is enough to start; the popup links to the sign-up page when no key is stored).
2. Open **API key** and copy the Sitelemetry MCP API key.
3. Paste it into the extension settings and use **Test connection**.

The key is stored with `chrome.storage.local` only (never the synced storage area), shown masked, and is sent only as the bearer token to the configured Sitelemetry base URL.

## Using the popup

1. Open the site you want to audit and click the toolbar button. The popup shows the site origin (for example `https://www.example.com`).
2. Click **Audit this site**. The first time, tick the ownership acknowledgement.
3. The audit runs on the Sitelemetry side. You can close the popup: the service worker keeps polling with the server's `pollArguments` and, if the browser suspends the worker, a `chrome.alarms` wake-up resumes the job from its stored state. The result is stored per site origin.
4. If the audit is still running when the extension's time budget (20 minutes) is over, the job is kept with its `jobId` and `pollArguments` and the button becomes **Check again**: it retrieves that same audit, so no second scan of the allowance is used. The job is only discarded once Sitelemetry answers with a final result.
5. Reopen the popup to see the score, the grade, severity counts, the top findings (each with location, evidence, impact and fix), **Passing checks**, **What was not measured**, a link to a report only if the server sends one, and the next step when ownership verification or the authorization terms are required. Sitelemetry saves no report of an audit run through the general `/mcp` endpoint the extension uses (the job keeps its result only while it is polled), so no text points to a report in the app: what the popup does not show is named as such. The popup lists up to ten findings, most severe first; a note under them says how many more findings of the result it does not show (and, when the AI fix prompt includes all of them, says so), and another says how many findings Sitelemetry counted but did not include in the result. **Passing checks** and **What was not measured** are closed at first: each heading shows the number of items (for example "Passing checks (29)", "What was not measured (7)") after an arrow; click it, or press Enter or Space on it, to open the section. **Passing checks** lists every check that passed, grouped by security module as sitelemetry.com names them, each with its evidence in smaller text, as Sitelemetry reported it in the report language; checks that were skipped or have no conclusive result are never listed there. The extension keeps up to 300 passing checks with a result; if the audit counted more, the heading gives both numbers (for example "Passing checks (300 of 342)") and the section says first how many were counted but not kept. A result stored by 0.1.2 has only the number of passing checks, and the section says that the list appears after the next audit. **What was not measured** names each module as sitelemetry.com does, says whether it was not measured or partly measured, and explains the reason when the extension recognises it: paths the site redirects (for example to its sign-in page), rate-limits or leaves unanswered, ports its firewall silently drops, scripts beyond the per-audit scan limit. The reason exactly as Sitelemetry reported it stays under each explanation. Unmeasured checks are not passes.
6. **Copy AI fix prompt** copies a plain-text prompt built from the stored result to the clipboard, to paste into an AI assistant of your choice. It lists the stored findings (most severe first) with their evidence and suggested fix, what was not measured and why, and asks for the root cause, an exact fix and a way to verify each one, answered in your browser's language. The prompt is built on the device and only copied to the clipboard; nothing is sent. Finding text is marked as data and neutralized so it cannot pose as instructions, and the prompt never contains the API key or job details. It stays within 30,000 characters; for a very large result the least severe findings are left out and the prompt says how many, and "Not measured" entries beyond the section's own budget are counted and left to the popup, which lists all of them. Findings Sitelemetry counted but did not include in the result are named as not included; no note of the prompt points to a report in the Sitelemetry app. **Show the prompt** opens the same text in a read-only field if copying is not possible.
7. The toolbar badge shows the last score for the site in that tab.

Results, gates and errors are reported as statuses, as in the Sitelemetry CI clients: `completed`, `partial`, `blocked`, `quota_exhausted`, `plan_required` and `verification_required`. A gate never starts an audit and never uses allowance.

## Languages

The popup and the settings page are available in the nine Sitelemetry languages: English, Turkish, Spanish, German, French, Portuguese, Italian, Japanese and Simplified Chinese (`_locales/en`, `tr`, `es`, `de`, `fr`, `pt_BR`, `pt_PT`, `it`, `ja`, `zh_CN`). Chrome and Edge pick the translation from the browser's UI language; other languages, including Traditional Chinese, show English. The audit is requested in the same language (the `lang` argument of `audit_security`: `en`, `tr`, `es`, `de`, `fr`, `pt`, `it`, `ja` or `zh`), so the findings and reasons Sitelemetry returns read like the rest of the popup. The language is sent with the call that starts the audit only; polls re-send the server's `pollArguments` unchanged.

## Plans and quota

The public catalogue at `https://sitelemetry.com/api/plans` is the source of truth; the popup reads it (cached for a day) for the plan box. At the time of writing the Free plan includes the security audit with 10 public security modules and 10 security scans per month; each completed audit uses one scan, polling does not. The plan box appears when the connected account is on the Free plan or when a plan or quota gate stopped the audit. It states the facts, the remaining allowance when the server reports it, what the paid plans include, and links to <https://sitelemetry.com/pricing> (`utm_source=browser-extension&utm_medium=extension`) and to the app for ownership verification. No pressure language anywhere; see `test/outcome.test.mjs`.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the URL of the tab in which you clicked the toolbar button, to derive the site origin to audit. Nothing is read from the page itself. Granted per click; no access to other tabs. |
| `storage` | Keep the API key, the base URL, the acknowledgement, the last result per site and the cached plan catalogue on this device (`chrome.storage.local`). |
| `alarms` | Wake the service worker every 30 seconds while an audit is running so polling continues after the popup is closed or the worker is suspended. |
| Host permission `https://sitelemetry.com/*` | Call the Sitelemetry MCP endpoint (`/mcp`) and the public plan catalogue (`/api/plans`). It is the only host the manifest grants access to and the default base URL; another Sitelemetry base URL set in the settings receives the same requests and the same bearer token (see [Staging base URL](#staging-base-url)). |

Not requested: `tabs` (no browsing history), `<all_urls>` (no page access), `scripting` (no content scripts), `identity`, `cookies`, `webRequest`. The content security policy of the extension pages is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https:; object-src 'none'; base-uri 'none'; form-action 'none'`.

Consequence of the minimal set: the badge is per tab and is set when the popup is opened for that tab and when its audit finishes. A finished audit only badges the tab if that tab still shows the audited site, so a score is never displayed over another website; when the URL of the tab is no longer visible to the extension (the `activeTab` grant lapses on navigation), no badge is set. Without the `tabs` permission the extension cannot observe navigations in other tabs, so it does not restore badges on tabs where you never opened the popup.

## Staging base URL

The settings page accepts an `https://` base URL for a staging deployment. The manifest only grants `https://sitelemetry.com/*`, so another host works only if it answers cross-origin requests from the extension origin (CORS: the `authorization`, `mcp-protocol-version` and `mcp-session-id` headers must be allowed) or if you add it to `host_permissions` in an unpacked developer build. Marketing links (pricing, app, sign-up) always point at the production site.

## What the extension sends and stores

- Sent to the configured Sitelemetry base URL, only when you click **Audit this site**: the site origin (for example `https://example.com`), the audit kind (`security`), the report language (a language code such as `tr`, from the browser's UI language) and your API key as the bearer token; then the server's `pollArguments` unchanged while the job runs. **Test connection** sends the MCP `initialize` request. The plan catalogue request carries no user data.
- Stored on this device: see the permissions table. Results can contain URLs and response details of the audited site. Remove the key in the settings or uninstall the extension to delete everything.
- Copy AI fix prompt: built on this device from the stored result and written only to the clipboard. Nothing is sent to Sitelemetry or anywhere else.
- Never: page content, browsing history, cookies, analytics or crash reports. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

Node.js 20 or newer (developed on Node.js 24). No dependencies to install.

```sh
npm test          # node:test suite against a local mock of the Sitelemetry service
npm run check     # manifest validation and the no-remote-code scan
npm run icons     # regenerate icons/*.png (dependency-free PNG writer)
npm run pack      # dist/sitelemetry-audit-<version>.zip for both stores (PowerShell)
```

`dev/harness.html` renders the popup and the options page in a normal browser tab with a stubbed `chrome.*` API (`node dev/serve.mjs`, then open the printed URL) for layout work without loading the extension; scenarios and the browser UI language (`&lang=tr`, `pt-BR`, `zh-CN`...) are selected with query parameters (see the file header).

Translations: every key of `_locales/en/messages.json` must exist in every locale with the same placeholders; `npm test` checks this, and `npm run check` checks the locale folder names and the translated store description length (132 characters).

Layout:

```
manifest.json               MV3 manifest (permissions, CSP, service worker, popup, options)
_locales/                   every user-facing string: en (default) and tr, es, de, fr, pt_BR, pt_PT, it, ja, zh_CN
icons/                      16/32/48/128 PNG icons generated by scripts/make-icons.mjs
src/shared/mcp-client.js    JSON-RPC over HTTP client for {base}/mcp (initialize, tools/call)
src/shared/audit.js         start/poll loop: re-sends pollArguments, honours retryAfterMs, resumable
src/shared/outcome.js       status classification and findings normalization
src/shared/text.js          headings, next steps and the plan box through the translator
src/shared/not-measured.js  "What was not measured": module names, status words, explanations
src/shared/passing.js       "Passing checks": the module of each check id, the groups and notes
src/shared/fix-prompt.js    the "Copy AI fix prompt" text, built from a stored result (no DOM)
src/shared/plans.js         GET /api/plans with a one-day cache
src/shared/storage.js       chrome.storage.local access, origin and base URL helpers
src/shared/badge.js         toolbar badge text and colour
src/shared/i18n.js          chrome.i18n wrapper with a Node fallback for any locale; report language
src/shared/links.js         pricing, app and sign-up links with utm parameters
src/background/service-worker.js   audit driver, alarms, badge, messages
src/popup/                  popup page, styles and rendering
src/options/                settings page
scripts/                    make-icons, validate-manifest, check-no-remote-code, pack.ps1
test/                       node:test suite, mock server (MIT, from the Audit Action) and fixtures
dev/                        browser harness with a stubbed chrome API
docs/                       STORE-LISTING, PRIVACY, SUBMISSION, PACKAGING
```

## License

MIT, see [LICENSE](LICENSE). `test/mock-server.mjs` and the fixtures are copied from the Sitelemetry Audit Action (MIT); the extension adds its own fixtures and the check lists in them.
