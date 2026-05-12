# Privacy

Utility Energy Downloader is designed to run locally in the user's browser.

Use this extension only with your own authorized utility account.

## Data collected by the extension

The extension stores meter usage interval rows captured from the user's logged-in electric utility energy usage page.
The page hook forwards only the minimal usage interval fields needed for export (`readDate`, `readTime`, and `usage`) from the utility page context into the extension content script.

Stored fields currently include:

- local timestamp
- read date
- read time
- usage in kWh

## Data not collected by the extension

The extension does not intentionally collect:

- utility account usernames
- utility account passwords
- authentication tokens
- cookies
- billing PDFs
- payment information
- hourly temperature data

The extension is scoped to the supported utility's post-login energy usage page. It is not injected into the separate sign-in provider page and cannot run there.

## Data sharing

The extension does not send energy usage data, credentials, or telemetry to any server controlled by the extension author.

Data remains in Chrome's local extension storage until the user clears it with the extension's clear control, uninstalls the extension, clears browser data, or otherwise clears the extension's local storage.

The `unlimitedStorage` permission is used only so multi-year usage downloads can keep all downloaded interval rows locally in the browser profile. It does not enable a backend service, remote sync, analytics, or data sharing by this extension.

Because the extension automates the user's existing authenticated utility browser session, the supported utility site receives the normal authenticated page and API requests needed to load usage data.

Exports are generated locally in the browser as CSV files. The Time-of-Use Rate Analyzer, available at `https://offpeakadvisor.com`, can import the same sanitized CSV through the extension bridge only after the user approves the pending request in the extension popup. The shared CSV contains the local timestamp, read date, read time, read time occurrence, interval index, and usage in kWh. No credentials, cookies, authentication tokens, billing PDFs, payment information, account numbers, or telemetry are shared by this bridge.

The extension limits use of user data to its single purpose: downloading, locally storing, exporting, and user-approved sharing of the user's own energy interval data for personal energy analysis. The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Site access

The extension requests access only to the supported utility account site.

This access is needed so the extension can observe the usage time-series response already loaded by the utility page in the user's own authenticated browser session.

## Unofficial status

> [!IMPORTANT]
> This extension is independent and is not affiliated with, endorsed by, approved by, or sponsored by any electric utility.
