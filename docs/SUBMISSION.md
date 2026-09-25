# Submitting to the Chrome Web Store and Microsoft Edge Add-ons

One package serves both stores: `dist/sitelemetry-audit-<version>.zip` from `npm run pack` (see PACKAGING.md). Text for every listing field is in STORE-LISTING.md; the privacy policy to host is PRIVACY.md.

## Before the first submission

- [ ] `npm test` and `npm run check` pass.
- [ ] `manifest.json` version bumped (also `src/shared/version.js` and `package.json`; the tests enforce that they match) and CHANGELOG.md updated.
- [ ] PRIVACY.md is hosted at a public URL (for example in the public GitHub repository, or a page on sitelemetry.com). Both stores require the link.
- [ ] Screenshots (1280x800) taken from a site you own; at least one, up to five.
- [ ] A support contact: an e-mail address or a support URL on sitelemetry.com.
- [ ] Decide the publisher identity: the developer account name is shown on the listing ("Sitelemetry").

## Chrome Web Store

1. **Developer account.** Sign in to the Chrome Web Store Developer Dashboard (https://chrome.google.com/webstore/devconsole) with the Google account that will own the listing (a shared organisation account is better than a personal one). Pay the one-time developer registration fee of USD 5 and complete the account details, including the verified contact e-mail (Google sends a verification mail; the listing cannot be published until it is confirmed). A group publisher can be set up later to share access.
2. **New item.** Click **New item**, upload the zip. The dashboard parses the manifest and reports errors immediately (a wrong file layout, a manifest key it rejects, an icon that does not match).
3. **Store listing tab.** Paste the name, summary, description and category from STORE-LISTING.md; upload the icon (128 px), screenshots and, optionally, the promo tiles. Set the official URL to https://sitelemetry.com and the support URL.
4. **Privacy practices tab.** Fill in the single purpose, the per-permission justifications, "no remote code", the data usage disclosures and the three certifications exactly as written in STORE-LISTING.md, and the privacy policy URL. This tab is the most common cause of a rejection; the justifications must match the manifest.
5. **Distribution tab.** Visibility **Public**, all regions, free. Leave "Trader" as appropriate for the company (an EU DSA requirement: a business publishing the extension is a trader and must provide address and contact details).
6. **Submit for review.** Reviews typically take one to three days for a small extension with narrow permissions; the dashboard shows the status and a rejection names the policy. Reply through the dashboard or fix and resubmit. Enable "publish automatically after review" if you want the item live as soon as it is approved.
7. **After approval.** The store page URL contains the item id; add it to the README and to the sitelemetry.com integrations page. Updates: bump the version, `npm run pack`, upload the new zip on the item's **Package** tab, submit. Users get the update automatically within hours.

Common review findings and how this extension avoids them:

- "Use of permissions that are not required": only `activeTab`, `storage`, `alarms` and one host permission; each is justified in the listing.
- "Remote code": none. The CSP forbids it and `scripts/check-no-remote-code.mjs` is part of the test suite.
- "Missing or insufficient privacy policy": PRIVACY.md lists exactly what is sent and stored.
- "Misleading description": the description states that a Sitelemetry account and API key are needed and that audits count against the account's allowance.

## Microsoft Edge Add-ons

1. **Partner Center.** Register at https://partner.microsoft.com/dashboard/microsoftedge/ with a Microsoft account (work account recommended). Registration for Edge extensions is free.
2. **Create new extension.** Upload the same zip. Partner Center validates the manifest; MV3 with a module service worker is supported.
3. **Availability.** Public, all markets (or a subset), free.
4. **Properties.** Category **Developer tools**, privacy policy URL, website URL, support contact. Declare that the extension does not use "extra permissions" beyond those in the manifest and does not collect personal information beyond what the policy describes.
5. **Store listing.** One listing per language; English is required. Paste name, short description, description, upload the logo (300x300 PNG is requested by Partner Center; export `icons/icon128.png` upscaled or render a 300 px variant with `scripts/make-icons.mjs` by adding the size), screenshots and optional promotional tiles.
6. **Notes for certification.** Paste the note from STORE-LISTING.md. Do not include an API key: the reviewer can create a free account. If the reviewer needs a working account and a site to audit, provide a dedicated review account created for that purpose and rotate its key after the review; never share a production key.
7. **Publish.** Certification usually completes within seven business days; the dashboard shows the outcome and the reasons for a failure. Updates follow the same steps with a higher version number.

## Firefox

Not targeted by this package. Firefox needs `browser_specific_settings.gecko.id`, uses `background.scripts` instead of a module service worker in some versions, and reviews source separately. A port is straightforward because the shared modules have no Chrome-specific code, but it is out of scope for this submission.

## Versioning and updates

Version numbers must increase with every store upload (`0.1.0` -> `0.1.1` -> `0.1.2` -> `0.1.3`).

For 0.1.3 no permission or host permission changes, and nothing new is sent: the popup lists the passing checks of a result (the checks with status `ok` that Sitelemetry already returns in `auditDetails.checks.items`), grouped by security module, and "Passing checks" and "What was not measured" become collapsible sections (closed by default, with the number of items in their headings); ten translated messages are added to every locale. The notes about findings or measurements that are not listed, the job errors and the AI fix prompt no longer point to a report or to the audits in the Sitelemetry app, which keeps no report of audits run through the general `/mcp` endpoint: five messages are reworded in every locale, and the prompt names what the result or the prompt does not include instead. Nothing about the data the extension sends or stores changes with that. The stored result now also keeps the title and evidence of up to 300 passing checks on the device, which is audit output of the site like the findings and fits no new privacy-practices category, so those answers stay as they are; upload the refreshed PRIVACY.md text (its "What the extension stores" list names the passing checks, and "Deleting your data" says that audit results are kept only on the device instead of naming audit records in the app) to the hosted policy URL and paste "What's new in 0.1.3" from STORE-LISTING.md into the update notes. The long description gains a "Passing checks" line and mentions the collapsible sections; updating the listing description with it is optional.

Replace listing screenshot 2 in both stores with the new `store-assets/screenshot-2.png` (1280x800): in the Chrome Web Store on the item's **Store listing** tab, and in Microsoft Edge Add-ons on the **Store listings** page of every language listing that has it; remove the old second screenshot and upload the new file in the same position. This is required, not optional: the screenshot 2 taken on 2026-09-22 and uploaded so far shows the note "4 more finding(s) are listed in the full report in the app.", which 0.1.3 removes because Sitelemetry keeps no report of these audits, and the old layout without "Passing checks". The new file is taken from the 0.1.3 build with the same stored partial result of https://sitelemetry.com: the whole popup in two panels side by side, with the new note under the findings ("4 more finding(s) of this result are not shown in this list; the AI fix prompt includes them."), "Passing checks (64)" closed and "What was not measured (3)" open. Screenshots 1, 3, 4 and 5 can stay; none of them names a report or the app.

For 0.1.2 no permission, host permission or data use changes: the package adds translations (`_locales/tr`, `es`, `de`, `fr`, `pt_BR`, `pt_PT`, `it`, `ja`, `zh_CN`), and the popup now sends the browser's UI language as the report language (the existing `lang` argument of `audit_security`, a code such as `tr`) with the request that starts an audit, to the same Sitelemetry host as before. It is not personal data and fits none of the privacy-practices categories, so those answers stay as they are; upload the refreshed PRIVACY.md text (it now names the report language) to the hosted policy URL and paste "What's new in 0.1.2" from STORE-LISTING.md into the update notes. The store picks up the translated name and short description from the package; nothing else in the listing has to change.

For 0.1.1 no permission, host permission or data use changes: the new **Copy AI fix prompt** button writes to the clipboard from the popup's click handler (no `clipboardWrite` permission) and makes no request, so the privacy practices answers stay as they are. Mention the button in the "what changed" notes of the update and upload the refreshed PRIVACY.md text to the hosted policy URL. Keep `manifest.json`, `src/shared/version.js` and `package.json` in sync (the tests fail otherwise), describe the change in CHANGELOG.md, run `npm run pack`, upload to both stores.
