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

Version numbers must increase with every store upload (`0.1.0` -> `0.1.1`).

For 0.1.1 no permission, host permission or data use changes: the new **Copy AI fix prompt** button writes to the clipboard from the popup's click handler (no `clipboardWrite` permission) and makes no request, so the privacy practices answers stay as they are. Mention the button in the "what changed" notes of the update and upload the refreshed PRIVACY.md text to the hosted policy URL. Keep `manifest.json`, `src/shared/version.js` and `package.json` in sync (the tests fail otherwise), describe the change in CHANGELOG.md, run `npm run pack`, upload to both stores.
