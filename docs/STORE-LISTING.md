# Store listing

Copy for the Chrome Web Store and Microsoft Edge Add-ons. Both stores take the same package (`dist/sitelemetry-audit-<version>.zip`, see PACKAGING.md). Plain text only in the description fields; neither store renders Markdown.

## Name

Sitelemetry Audit

## Short description (Chrome "summary", Edge "short description"; limit 132 characters)

Run a Sitelemetry security audit of the site in the current tab: score, findings and fixes. Audit only sites you own or may test.

(131 characters. This is also the manifest description, `extensionDescription` in `_locales/en/messages.json`.)

## Description

Sitelemetry Audit runs a security audit of the website in your current tab through your Sitelemetry account and shows the result right in the popup.

What you get
- A security score from 0 to 100 with a grade and severity counts.
- The top findings with location, evidence, impact and a concrete fix.
- "Passing checks": a collapsible section whose heading shows how many checks passed; open it to see each one, grouped by security module, with its evidence.
- "What was not measured": a collapsible section whose heading shows how many checks were skipped, unavailable or require ownership verification; open it to see each one with its reason, such as paths the site redirects to its sign-in page or ports its firewall silently drops. Unmeasured checks are not passes.
- "Copy AI fix prompt": copies a plain-text prompt built from the result, listing the findings and asking for a root cause, a step-by-step fix and a verification step for each, to paste into an AI assistant of your choice. The prompt is built on your device and only copied to your clipboard.
- A toolbar badge with the last score for the site in that tab.
- The audit keeps running after you close the popup; the result is stored for the site.
- Available in English, Turkish, Spanish, German, French, Portuguese, Italian, Japanese and Simplified Chinese; results arrive in the language of your browser.

How it works
1. Add your Sitelemetry MCP API key in the extension settings (sign in at sitelemetry.com/app; a Free account is enough to start).
2. Open the site you own and click the toolbar button, then "Audit this site".
3. The extension sends the site origin, the audit kind and the report language to Sitelemetry, polls the running audit and shows the result.

Ownership and authorization
Audit only websites you own or are explicitly authorized to test. Every audit is performed by Sitelemetry against the live site and is recorded on the connected account. The extension asks for an acknowledgement before the first audit.

Plans
A Free Sitelemetry account includes the security audit with public security modules and a monthly allowance of security scans; each completed audit uses one scan. The popup shows the plan and usage facts of the connected account and links to the plan details when a plan or allowance limit stops an audit. Plan facts come from the public catalogue at sitelemetry.com/api/plans.

Privacy
The extension has no analytics, no content scripts and no access to page content or browsing history. It contacts only the Sitelemetry host configured in its settings (https://sitelemetry.com by default, and the only host the extension is granted access to): the site origin you audit, the audit kind, the report language (the language of your browser) and your API key (as the bearer token) are sent when you click "Audit this site". Your key, your acknowledgement and the last result per site are stored on your device only. The AI fix prompt is built on your device and only copied to your clipboard; nothing is sent. Full policy: see the privacy policy link on this listing.

Open source under the MIT license.

## Category

- Chrome Web Store: Developer Tools
- Microsoft Edge Add-ons: Developer tools

## What's new in 0.1.3

Paste into the "what changed" note of the update (both stores; if 0.1.2 was never uploaded to a store, paste the 0.1.2 note below it as well):

The popup now lists the checks that passed, not only their number: "Passing checks" opens to every passing check, grouped by security module, with its evidence. "Passing checks" and "What was not measured" are collapsible sections, closed by default, whose headings show how many items they hold. The notes under the findings now say exactly what is not listed: how many findings the popup list does not show and whether the AI fix prompt includes them, and how many findings Sitelemetry counted but did not include in the result; the AI fix prompt names what it leaves out the same way. No new permissions.

## What's new in 0.1.2

Paste into the "what changed" note of the update (both stores):

Sitelemetry Audit now speaks all nine Sitelemetry languages: English, Turkish, Spanish, German, French, Portuguese, Italian, Japanese and Simplified Chinese. The popup follows your browser's language and requests the audit results in the same language. "What was not measured" names each check and explains why it has no result, for example paths your site redirects to its sign-in page, or ports your firewall silently drops; the reason reported by the audit stays visible under each explanation. The AI fix prompt carries the same explanations and asks the assistant to answer in your language. No new permissions.

## Language

The extension UI ships in English (default), Turkish, Spanish, German, French, Portuguese (`pt_BR` and `pt_PT`, one translation), Italian, Japanese and Simplified Chinese (`zh_CN`). The name and short description are `extensionName` and `extensionDescription` of each locale (every translated description is within 132 characters; `npm run check` enforces it). The long description above is English; after the upload, check the language selector on the dashboard's store listing page and paste a translated description for a language only if you want to localize the listing text as well.

## Assets to prepare

| Asset | Size | Notes |
| --- | --- | --- |
| Store icon | 128x128 PNG | `icons/icon128.png` (Chrome pads it; keep the 16 px transparent margin rule in mind if redesigning). |
| Screenshots | 1280x800 or 640x400 PNG/JPEG, 1 to 5 | Suggested: (1) popup with a completed result, (2) popup with a partial result and "What was not measured", (3) popup while an audit runs, (4) settings page with a masked key and a successful connection test, (5) the plan box for a Free account. Use a site you own; blur nothing else is needed since no personal data appears. The uploaded set is `store-assets/screenshot-1.png` to `screenshot-5.png` (1280x800). For 0.1.3, screenshot 2 was taken again from the 0.1.3 build: the whole popup of the same partial result in two panels side by side, with the new findings note, "Passing checks (64)" closed and "What was not measured (3)" open. Replace screenshot 2 in both stores with this file (see "Versioning and updates" in SUBMISSION.md); the one uploaded before still shows the removed note that more findings are listed in a full report in the app. |
| Small promo tile (Chrome) | 440x280 PNG/JPEG | Optional but improves placement. |
| Marquee promo tile (Chrome) | 1400x560 | Optional. |
| Edge promotional tiles | 440x280 (small), 1400x560 (large) | Optional. |

## Chrome Web Store: Privacy practices tab

**Single purpose description**

Run a Sitelemetry security audit of the website in the current tab through the user's Sitelemetry account and show the result in the popup.

**Permission justifications**

- `activeTab`: to read the URL of the tab in which the user clicked the toolbar button and derive the site origin to audit. No page content is read and no script is injected.
- `storage`: to keep the user's Sitelemetry API key, base URL, ownership acknowledgement, the last audit result per site and a cached copy of the public plan catalogue on the device.
- `alarms`: to wake the background service worker every 30 seconds while an audit is running so that polling continues after the popup is closed.
- Host permission `https://sitelemetry.com/*`: to call the Sitelemetry MCP endpoint (`/mcp`) that runs the audit and the public plan catalogue (`/api/plans`). It is the only host the manifest grants access to, and the default base URL of the extension.

**Remote code**: No, the extension does not use remote code. All scripts are packaged; the CSP is `script-src 'self'; object-src 'none'`.

**Data usage** (what the extension collects or transmits)

- Authentication information: yes. The user's Sitelemetry API key is entered by the user, stored locally and transmitted as the bearer token that authenticates the audit request to the Sitelemetry host configured in the settings. That is https://sitelemetry.com by default. The settings accept another `https://` base URL for a self-hosted or staging Sitelemetry deployment; such a host then receives the same requests and the same bearer token, and the settings page warns about it. The key is transmitted to no other party.
- Web history: the origin of the site the user explicitly chooses to audit (for example `https://example.com`) is transmitted to the configured Sitelemetry host when the user clicks "Audit this site". Nothing is collected automatically and no browsing history is read. Disclose this conservatively as "Web history" if the reviewer form requires a category; the extension does not read history or visited pages.
- The report language, a language code such as `tr` taken from the browser's UI language, goes with the same request so that the results arrive in that language. It identifies no one and falls under none of the form's categories.
- Personally identifiable information, health, financial, personal communications, location, user activity, website content: no.

**Certifications** (tick all three)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: a public URL of `docs/PRIVACY.md` (for example on the public GitHub repository or a page on sitelemetry.com).

## Microsoft Edge Add-ons: listing fields

- Display name: Sitelemetry Audit
- Short description: as above.
- Description: as above.
- Category: Developer tools
- Privacy policy URL: same URL as for Chrome.
- Website URL: https://sitelemetry.com
- Support contact: the support address of sitelemetry.com.
- Notes for certification: "The extension needs a Sitelemetry MCP API key, available from a free account at https://sitelemetry.com/app (sign in, open API key). Audit a site you own. The extension contacts only the Sitelemetry host configured in its settings (https://sitelemetry.com by default, the only host in host_permissions); the package contains no remote code. Tests: `npm test` in the source repository."
