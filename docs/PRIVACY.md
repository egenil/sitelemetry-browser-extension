# Privacy policy: Sitelemetry Audit browser extension

Last updated: 2026-09-25

Sitelemetry Audit is a browser extension for Chrome and Microsoft Edge that runs a security audit of a website you own through your Sitelemetry account. This policy describes what the extension itself sends, stores and never does. The Sitelemetry service (sitelemetry.com) has its own terms and privacy policy, which apply to your account and to the audits recorded on it.

## What the extension sends, and to whom

The extension contacts only the Sitelemetry host configured in its settings. That is `https://sitelemetry.com` by default, and it is the only host the manifest grants access to. If you change the base URL to another Sitelemetry deployment (for example a staging host you operate), that host receives the same requests, including your API key as the bearer token. No other server is contacted.

| When | What is sent | Why |
| --- | --- | --- |
| You click **Audit this site** | The origin of the site in the current tab (scheme, host and port, for example `https://example.com`), the audit kind (`security`) and your Sitelemetry MCP API key as the HTTP bearer token | To start the audit on your account |
| While the audit runs | The server's `pollArguments` (the same origin and the job id), with the API key | To retrieve the result of the same audit without starting another one |
| You click **Test connection** in the settings | An MCP `initialize` request with the API key | To confirm the key and the host |
| The popup opens | A request to the public plan catalogue `/api/plans` (no user data, at most once a day) | To show factual plan and usage information |

The extension does not send page content, page titles, cookies, form data, browsing history, other tabs, or any identifier of your browser or device. It contains no analytics, telemetry or crash reporting.

## Copy AI fix prompt

The **Copy AI fix prompt** button in the popup builds a text prompt from the audit result already stored on your device and writes it to your clipboard; the same text can also be shown in a read-only field. The prompt is built locally and nothing is sent anywhere: no request is made to Sitelemetry or to any other service, and the extension does not open or contact an AI service. It contains the audited site origin and the stored result (score, findings, what was not measured), never your API key or job identifiers. What happens to the text after you paste it into another application is governed by that application. Copying uses the standard clipboard API during your click and needs no additional permission.

## What the extension stores

Everything is stored on your device with the browser's local extension storage (`chrome.storage.local`). Nothing is synchronized to other devices or to us.

- Your Sitelemetry MCP API key (shown masked in the settings).
- The base URL (only if you changed it).
- The date of your ownership acknowledgement.
- The last audit result for each site you audited (at most 50 sites). A result contains the score, the findings and the server's text for that site; findings can include URLs and response details of the audited site.
- A cached copy of the public plan catalogue.

## Permissions

- `activeTab`: lets the extension read the URL of the tab in which you clicked the toolbar button, to derive the site origin. It grants no access to page content and no access to other tabs.
- `storage`: local storage described above.
- `alarms`: wakes the background worker every 30 seconds while an audit runs so that polling can continue after the popup is closed.
- Host permission `https://sitelemetry.com/*`: the only host the manifest grants access to, and the default base URL. Another base URL set in the settings reaches the network only if that host answers cross-origin requests from the extension, or if it is added to the host permissions in an unpacked developer build.

The extension does not request the `tabs`, `history`, `cookies`, `scripting` or `<all_urls>` permissions and injects no scripts into web pages.

## Ownership and authorization

Use the extension only on websites you own or are explicitly authorized to test. Each audit is performed by Sitelemetry against the live site and is recorded on your Sitelemetry account under the service's terms.

## Deleting your data

Remove the API key in the extension settings, or uninstall the extension: the browser then deletes everything the extension stored. Audit records on your Sitelemetry account are managed in the app at https://sitelemetry.com/app.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

Changes to this policy are published with a new version of the extension and noted in its changelog.

## Contact

Sitelemetry, https://sitelemetry.com. Use the contact options on the website for questions about this policy.
