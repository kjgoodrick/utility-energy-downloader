#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outputDirs = process.env.STORE_PROMO_DIR
  ? [resolve(process.env.STORE_PROMO_DIR)]
  : [
      join(repoRoot, "docs", "promo"),
      join(repoRoot, "release", "chrome-web-store", "promo")
    ];
const iconData = readFileSync(join(repoRoot, "icons", "icon128.png")).toString("base64");

const tiles = [
  {
    filename: "small-promo-tile.png",
    width: 440,
    height: 280,
    title: "Download energy data",
    subtitle: "No account sharing required",
    eyebrow: "No passwords. No servers.",
    compact: true
  },
  {
    filename: "marquee-promo-tile.png",
    width: 1400,
    height: 560,
    title: "Download detailed utility data locally",
    subtitle: "Export CSV from your utility account without sharing credentials. Approve browser-only rate analysis when you choose.",
    eyebrow: "No passwords. No servers.",
    compact: false
  }
];

for (const outputDir of outputDirs) {
  mkdirSync(outputDir, { recursive: true });
}

const browser = await launchBrowser();
try {
  for (const tile of tiles) {
    const page = await browser.newPage({
      viewport: { width: tile.width, height: tile.height },
      deviceScaleFactor: 1,
      colorScheme: "light"
    });
    await page.setContent(renderTile(tile), { waitUntil: "load" });
    const screenshot = await page.screenshot({ fullPage: false, omitBackground: false });
    await page.close();
    for (const outputDir of outputDirs) {
      const outputPath = join(outputDir, tile.filename);
      writeFileSync(outputPath, screenshot);
      console.log(`Wrote ${outputPath}`);
    }
  }
} finally {
  await browser.close();
}

async function launchBrowser() {
  const common = { headless: true };
  if (process.env.CHROME_BIN) {
    return chromium.launch({ ...common, executablePath: process.env.CHROME_BIN });
  }
  try {
    return await chromium.launch(common);
  } catch (bundledError) {
    try {
      return await chromium.launch({ ...common, channel: "chrome" });
    } catch (chromeError) {
      throw new Error(
        `Could not launch a browser for promo tiles. Run "npx playwright install chromium" or set CHROME_BIN.\n\nBundled Chromium error:\n${bundledError.message}\n\nChrome error:\n${chromeError.message}`
      );
    }
  }
}

function renderTile(tile) {
  const modeClass = tile.compact ? "compact" : "marquee";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(tile.title)}</title>
    <style>
      :root {
        color: #111418;
        background: #f2eee7;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-synthesis: none;
        text-rendering: optimizeLegibility;
      }

      * {
        box-sizing: border-box;
      }

      body {
        width: ${tile.width}px;
        height: ${tile.height}px;
        margin: 0;
        overflow: hidden;
        background: #f2eee7;
      }

      .tile {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 34px;
        width: 100%;
        height: 100%;
        padding: 54px 70px;
        background:
          linear-gradient(115deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.16)),
          #f2eee7;
      }

      .copy {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 28px;
        color: #3d444f;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.035em;
        text-transform: uppercase;
      }

      .brand img {
        width: 52px;
        height: 52px;
        flex: 0 0 auto;
      }

      .eyebrow {
        margin: 0 0 12px;
        color: #4e79a7;
        font-size: 21px;
        font-weight: 800;
      }

      h1 {
        max-width: 640px;
        margin: 0;
        color: #111418;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 62px;
        line-height: 1.02;
        letter-spacing: 0;
      }

      .subtitle {
        max-width: 610px;
        margin: 22px 0 0;
        color: #424b58;
        font-size: 24px;
        line-height: 1.35;
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 34px;
      }

      .badge {
        border: 1px solid rgba(17, 20, 24, 0.13);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.62);
        color: #29313a;
        padding: 9px 14px;
        font-size: 15px;
        font-weight: 800;
      }

      .visual {
        position: relative;
        min-width: 0;
      }

      .browser {
        position: absolute;
        right: 0;
        top: 8px;
        width: 560px;
        height: 380px;
        border: 1px solid rgba(17, 20, 24, 0.13);
        border-radius: 8px;
        background: #f8f8f9;
        box-shadow: 0 24px 58px rgba(60, 50, 38, 0.24);
        overflow: hidden;
      }

      .chrome {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 38px;
        border-bottom: 1px solid #ececee;
        background: #fafafa;
        padding: 0 13px;
      }

      .dots {
        display: flex;
        gap: 6px;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #d4d6da;
      }

      .url {
        flex: 1;
        border: 1px solid #e0e2e5;
        border-radius: 999px;
        background: #ffffff;
        color: #69717d;
        padding: 5px 12px;
        font-size: 12px;
      }

      .usage {
        display: grid;
        gap: 14px;
        padding: 26px;
      }

      .usage h2 {
        margin: 0;
        color: #242931;
        font-size: 25px;
        letter-spacing: 0;
      }

      .usage-card {
        width: 220px;
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
        padding: 15px;
      }

      .usage-card span {
        display: block;
        color: #69717d;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .usage-card strong {
        display: block;
        margin-top: 8px;
        color: #17191d;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 31px;
        line-height: 1;
      }

      .chart {
        display: flex;
        align-items: end;
        gap: 7px;
        width: 300px;
        height: 135px;
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
        padding: 15px;
      }

      .bar {
        flex: 1;
        min-width: 0;
        border-radius: 5px 5px 0 0;
        background: #4e79a7;
        opacity: 0.55;
      }

      .popup {
        position: absolute;
        right: 34px;
        top: 92px;
        width: 295px;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 20px 52px rgba(17, 20, 24, 0.25);
        padding: 16px;
      }

      .popup h3 {
        margin: 0;
        color: #111418;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 26px;
        line-height: 1.05;
      }

      .popup p {
        margin: 7px 0 13px;
        color: #4f5663;
        font-size: 13px;
        line-height: 1.35;
      }

      .progress {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: #f2f3f4;
      }

      .fill {
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: #4e79a7;
      }

      .metrics {
        display: grid;
        gap: 7px;
        margin-top: 12px;
        color: #626875;
        font-size: 13px;
      }

      .metric {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .metric strong {
        color: #111418;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-top: 14px;
      }

      .button {
        border-radius: 6px;
        background: #111418;
        color: #ffffff;
        padding: 9px 10px;
        text-align: center;
        font-size: 13px;
        font-weight: 800;
      }

      .compact.tile {
        grid-template-columns: 215px 1fr;
        gap: 16px;
        padding: 24px 28px;
      }

      .compact .brand {
        gap: 10px;
        margin-bottom: 15px;
        font-size: 12px;
      }

      .compact .brand img {
        width: 36px;
        height: 36px;
      }

      .compact .eyebrow {
        margin-bottom: 7px;
        font-size: 14px;
      }

      .compact h1 {
        max-width: 205px;
        font-size: 31px;
        line-height: 1;
      }

      .compact .subtitle {
        max-width: 205px;
        margin-top: 10px;
        font-size: 16px;
        line-height: 1.25;
      }

      .compact .badges {
        display: none;
      }

      .compact .browser {
        right: -64px;
        top: 20px;
        width: 245px;
        height: 190px;
        box-shadow: 0 18px 42px rgba(60, 50, 38, 0.23);
      }

      .compact .chrome {
        height: 24px;
        padding: 0 8px;
      }

      .compact .dot {
        width: 6px;
        height: 6px;
      }

      .compact .url {
        font-size: 7px;
        padding: 3px 7px;
      }

      .compact .usage {
        gap: 8px;
        padding: 14px;
      }

      .compact .usage h2 {
        font-size: 15px;
      }

      .compact .usage-card {
        width: 110px;
        padding: 8px;
        border-radius: 6px;
      }

      .compact .usage-card span {
        font-size: 7px;
      }

      .compact .usage-card strong {
        margin-top: 4px;
        font-size: 17px;
      }

      .compact .chart {
        width: 140px;
        height: 65px;
        gap: 3px;
        padding: 8px;
        border-radius: 6px;
      }

      .compact .bar {
        border-radius: 3px 3px 0 0;
      }

      .compact .popup {
        right: -4px;
        top: 54px;
        width: 138px;
        border-radius: 6px;
        padding: 9px;
        box-shadow: 0 14px 34px rgba(17, 20, 24, 0.23);
      }

      .compact .popup h3 {
        font-size: 15px;
      }

      .compact .popup p {
        margin: 4px 0 7px;
        font-size: 7px;
      }

      .compact .progress {
        height: 5px;
      }

      .compact .metrics {
        gap: 4px;
        margin-top: 7px;
        font-size: 7px;
      }

      .compact .actions {
        gap: 5px;
        margin-top: 8px;
      }

      .compact .button {
        border-radius: 4px;
        padding: 5px 6px;
        font-size: 7px;
      }
    </style>
  </head>
  <body>
    <main class="tile ${modeClass}">
      <section class="copy">
        <div class="brand">
          <img alt="" src="data:image/png;base64,${iconData}">
          <span>Utility Energy Downloader</span>
        </div>
        <p class="eyebrow">${escapeHtml(tile.eyebrow)}</p>
        <h1>${escapeHtml(tile.title)}</h1>
        <p class="subtitle">${escapeHtml(tile.subtitle)}</p>
        <div class="badges">
          <span class="badge">Local storage</span>
          <span class="badge">CSV export</span>
          <span class="badge">No servers</span>
        </div>
      </section>
      <section class="visual" aria-label="Extension preview">
        <div class="browser">
          <div class="chrome">
            <div class="dots" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
            <div class="url">yourutility.com/energy-usage</div>
          </div>
          <div class="usage">
            <h2>Energy usage</h2>
            <div class="usage-card"><span>Total usage</span><strong>31.8 kWh</strong></div>
            <div class="chart" aria-hidden="true">
              ${[42, 58, 47, 69, 76, 63, 88, 71, 52, 60, 79, 93].map(height => `<span class="bar" style="height: ${height}%"></span>`).join("")}
            </div>
          </div>
        </div>
        <div class="popup">
          <h3>Energy Usage</h3>
          <p>Downloading usage data. You can close this popup.</p>
          <div class="progress"><div class="fill"></div></div>
          <div class="metrics">
            <div class="metric"><span>Days saved</span><strong>394</strong></div>
            <div class="metric"><span>Data points</span><strong>18,912</strong></div>
          </div>
          <div class="actions">
            <div class="button">CSV</div>
            <div class="button">Pause</div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
