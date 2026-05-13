#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outputDirs = process.env.STORE_SCREENSHOT_DIR
  ? [resolve(process.env.STORE_SCREENSHOT_DIR)]
  : [
      join(repoRoot, "docs", "screenshots"),
      join(repoRoot, "release", "chrome-web-store", "screenshots")
    ];
const width = Number(process.env.STORE_SCREENSHOT_WIDTH || 1280);
const height = Number(process.env.STORE_SCREENSHOT_HEIGHT || 800);

const popupHtml = readFileSync(join(repoRoot, "src", "popup.html"), "utf8");
const popupCss = readFileSync(join(repoRoot, "src", "popup.css"), "utf8");
const popupMarkup = extractPopupMarkup(popupHtml);
const scopedPopupCss = scopeCss(removeDarkModeBlock(popupCss), ".popup-doc");
const iconData = readFileSync(join(repoRoot, "icons", "icon128.png")).toString("base64");

const scenarios = [
  {
    id: "01-ready-local-download",
    eyebrow: "Local utility session",
    title: "Download detailed energy usage",
    copy: "The extension works from the logged-in utility page and keeps your usage data in local browser storage.",
    accent: "#4e79a7",
    utilityDate: "May 12, 2026",
    usage: "31.8 kWh",
    demand: "4.2 kW",
    state: {
      "#status": "Downloading usage data. You can close this popup.",
      "#start-date": "2024-05-12",
      "#end-date": "2026-05-12",
      "#progress-count": "28 of 731 days",
      "#eta": "about 32 min left",
      "#days-saved": "28",
      "#rows-saved": "1,344",
      "#current-day": "2024-06-09",
      "#bridge-status": "1,344 saved intervals are available as energy-usage-timeseries.csv. No analyzer request is waiting.",
      "#progress-fill": { style: { width: "4%" } },
      ".progress-bar": { attributes: { "aria-valuenow": "4" } },
      "#pause": { properties: { disabled: false } },
      "#start": { properties: { hidden: true } },
      "#resume": { properties: { hidden: true } },
      "#export-csv": { properties: { hidden: true } },
      "#clear-data": { properties: { hidden: true } },
      "#approve-share": { properties: { hidden: true } },
      "#decline-share": { properties: { hidden: true } },
      ".bridge": { properties: { hidden: true } }
    },
    badges: ["No password access", "Local storage", "User-controlled"]
  },
  {
    id: "02-resumable-progress",
    eyebrow: "Resumable capture",
    title: "Pause and resume long downloads",
    copy: "Long date ranges can pause and resume. Completed days stay saved even if the utility page refreshes.",
    accent: "#5f8f5f",
    utilityDate: "Nov 04, 2025",
    usage: "24.6 kWh",
    demand: "3.7 kW",
    state: {
      "#status": "Downloading usage data. You can close this popup.",
      "#start-date": "2024-05-12",
      "#end-date": "2026-05-12",
      "#progress-count": "394 of 731 days",
      "#eta": "about 18 min left",
      "#days-saved": "394",
      "#rows-saved": "18,912",
      "#current-day": "2025-06-10",
      "#bridge-status": "18,912 saved intervals are available as energy-usage-timeseries.csv. No analyzer request is waiting.",
      "#progress-fill": { style: { width: "54%" } },
      ".progress-bar": { attributes: { "aria-valuenow": "54" } },
      "#pause": { properties: { disabled: false } },
      "#start": { properties: { hidden: true } },
      "#resume": { properties: { hidden: true } },
      "#export-csv": { properties: { hidden: true } },
      "#clear-data": { properties: { hidden: true } },
      "#approve-share": { properties: { hidden: true } },
      "#decline-share": { properties: { hidden: true } },
      ".bridge": { properties: { hidden: true } }
    },
    badges: ["Pause anytime", "Resume later", "Daily checkpoints"]
  },
  {
    id: "03-csv-export",
    eyebrow: "CSV export",
    title: "Export a clean usage CSV",
    copy: "Exported files contain detailed timestamps and usage values, ready for spreadsheets or rate comparisons.",
    accent: "#c9933a",
    utilityDate: "Jan 18, 2026",
    usage: "42.1 kWh",
    demand: "5.1 kW",
    state: {
      "#status": "Download complete.",
      "#start-date": "2024-05-12",
      "#end-date": "2026-05-12",
      "#progress-count": "731 of 731 days",
      "#eta": "complete",
      "#days-saved": "731",
      "#rows-saved": "35,088",
      "#current-day": "-",
      "#bridge-status": "35,088 saved intervals are available as energy-usage-timeseries.csv. No analyzer request is waiting.",
      "#progress-fill": { style: { width: "100%" } },
      ".progress-bar": { attributes: { "aria-valuenow": "100" } },
      "#export-csv": { properties: { disabled: false } },
      "#start": { properties: { hidden: true } },
      "#resume": { properties: { hidden: true } },
      "#pause": { properties: { hidden: true } },
      "#clear-data": { properties: { hidden: true } },
      "#approve-share": { properties: { hidden: true } },
      "#decline-share": { properties: { hidden: true } },
      ".bridge": { properties: { hidden: true } }
    },
    badges: ["Sanitized data", "Spreadsheet-ready", "Offline file"]
  },
  {
    id: "04-analyzer-approval",
    eyebrow: "Explicit approval",
    title: "Your data stays in your browser",
    copy: "Approve sharing with the rate analyzer only when you choose. The handoff happens locally in your browser.",
    accent: "#7f6aa3",
    utilityDate: "Mar 21, 2026",
    usage: "28.4 kWh",
    demand: "3.9 kW",
    state: {
      "#status": "Ready. Saved data is available.",
      "#start-date": "2024-05-12",
      "#end-date": "2026-05-12",
      "#progress-count": "731 of 731 days",
      "#eta": "complete",
      "#days-saved": "731",
      "#rows-saved": "35,088",
      "#current-day": "-",
      "#bridge-status": "Share locally with offpeakadvisor.com in this browser. Data stays local; no servers receive it. Request: 35,088 saved data points.",
      "#progress-fill": { style: { width: "100%" } },
      ".progress-bar": { attributes: { "aria-valuenow": "100" } },
      "#start": { properties: { hidden: true } },
      "#resume": { properties: { hidden: true } },
      "#pause": { properties: { hidden: true } },
      "#export-csv": { properties: { hidden: true } },
      "#clear-data": { properties: { hidden: true } },
      "#approve-share": { properties: { disabled: false } },
      "#decline-share": { properties: { disabled: false } }
    },
    badges: ["Approval gate", "Local handoff", "No servers"]
  }
];

for (const outputDir of outputDirs) {
  mkdirSync(outputDir, { recursive: true });
}

const browser = await launchBrowser();
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "light"
    });
    await page.setContent(renderScenario(scenario), { waitUntil: "load" });
    const screenshot = await page.screenshot({ fullPage: false, omitBackground: false });
    await page.close();
    for (const outputDir of outputDirs) {
      const outputPath = join(outputDir, `${scenario.id}.png`);
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
        `Could not launch a browser for screenshots. Run "npx playwright install chromium" or set CHROME_BIN.\n\nBundled Chromium error:\n${bundledError.message}\n\nChrome error:\n${chromeError.message}`
      );
    }
  }
}

function renderScenario(scenario) {
  const stateScript = `(${applyState.toString()})(${JSON.stringify(scenario.state)});`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(scenario.title)}</title>
    <style>
      :root {
        color: #17191d;
        background: #efe9df;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-synthesis: none;
        text-rendering: optimizeLegibility;
      }

      * {
        box-sizing: border-box;
      }

      body {
        width: ${width}px;
        height: ${height}px;
        margin: 0;
        overflow: hidden;
        background: linear-gradient(120deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.18)), #efe9df;
      }

      .stage {
        display: grid;
        grid-template-columns: 450px 1fr;
        gap: 44px;
        width: 100%;
        height: 100%;
        padding: 58px 70px;
      }

      .copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        padding-bottom: 24px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 36px;
        color: #3f444c;
        font-weight: 750;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .brand img {
        width: 48px;
        height: 48px;
      }

      .eyebrow {
        margin: 0 0 12px;
        color: ${scenario.accent};
        font-size: 18px;
        font-weight: 800;
      }

      h1 {
        max-width: 420px;
        margin: 0;
        color: #111418;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 50px;
        line-height: 1.02;
        letter-spacing: 0;
      }

      .lede {
        max-width: 410px;
        margin: 22px 0 0;
        color: #4e5662;
        font-size: 21px;
        line-height: 1.38;
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 32px;
      }

      .badge {
        border: 1px solid rgba(17, 20, 24, 0.13);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.62);
        color: #29313a;
        padding: 8px 12px;
        font-size: 14px;
        font-weight: 750;
      }

      .browser {
        align-self: center;
        min-width: 0;
        border: 1px solid rgba(17, 20, 24, 0.13);
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 30px 72px rgba(60, 50, 38, 0.23);
        overflow: hidden;
      }

      .chrome {
        display: flex;
        align-items: center;
        gap: 14px;
        height: 44px;
        border-bottom: 1px solid #ececee;
        background: #fafafa;
        padding: 0 15px;
      }

      .dots {
        display: flex;
        gap: 7px;
      }

      .dot {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        background: #d4d6da;
      }

      .url {
        flex: 1;
        border: 1px solid #e0e2e5;
        border-radius: 999px;
        background: #ffffff;
        color: #69717d;
        padding: 6px 14px;
        font-size: 13px;
      }

      .browser-body {
        position: relative;
        height: 600px;
        background: #f8f8f9;
      }

      .utility-page {
        display: grid;
        gap: 18px;
        padding: 30px;
      }

      .utility-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .utility-title {
        margin: 0;
        color: #242931;
        font-size: 25px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .utility-date {
        color: #69717d;
        font-size: 14px;
        font-weight: 700;
      }

      .usage-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .usage-card {
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
        padding: 16px;
      }

      .usage-card span {
        display: block;
        color: #69717d;
        font-size: 13px;
        font-weight: 750;
        text-transform: uppercase;
      }

      .usage-card strong {
        display: block;
        margin-top: 10px;
        color: #17191d;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 31px;
        line-height: 1;
      }

      .chart {
        display: flex;
        align-items: end;
        gap: 7px;
        height: 210px;
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
        padding: 18px;
      }

      .bar {
        flex: 1;
        min-width: 0;
        border-radius: 5px 5px 0 0;
        background: ${scenario.accent};
        opacity: 0.55;
      }

      .popup-shadow {
        position: absolute;
        right: 30px;
        top: 42px;
        width: 360px;
        border-radius: 8px;
        box-shadow: 0 22px 60px rgba(17, 20, 24, 0.28);
        overflow: hidden;
      }

      ${scopedPopupCss}

      .popup-doc [hidden] {
        display: none !important;
      }

      .popup-doc #open-utility {
        display: none;
      }

      .popup-doc .actions {
        grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
      }

    </style>
  </head>
  <body>
    <main class="stage">
      <section class="copy" aria-label="Store screenshot caption">
        <div class="brand">
          <img alt="" src="data:image/png;base64,${iconData}">
          <span>Utility Energy Downloader</span>
        </div>
        <p class="eyebrow">${escapeHtml(scenario.eyebrow)}</p>
        <h1>${escapeHtml(scenario.title)}</h1>
        <p class="lede">${escapeHtml(scenario.copy)}</p>
        <div class="badges">
          ${scenario.badges.map(badge => `<span class="badge">${escapeHtml(badge)}</span>`).join("\n          ")}
        </div>
      </section>

      <section class="browser" aria-label="Extension screenshot">
        <div class="chrome">
          <div class="dots" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="url">yourutility.com/energy-usage</div>
        </div>
        <div class="browser-body">
          <div class="utility-page">
            <div class="utility-header">
              <h2 class="utility-title">Energy usage</h2>
              <span class="utility-date">${escapeHtml(scenario.utilityDate)}</span>
            </div>
            <div class="usage-grid">
              <div class="usage-card"><span>Total usage</span><strong>${escapeHtml(scenario.usage)}</strong></div>
              <div class="usage-card"><span>Peak demand</span><strong>${escapeHtml(scenario.demand)}</strong></div>
            </div>
            <div class="chart" aria-hidden="true">
              ${[42, 58, 47, 69, 76, 63, 88, 71, 52, 60, 79, 93, 67, 55, 73, 84, 61, 49, 66, 78, 57, 44, 53, 64].map(barHeight => `<span class="bar" style="height: ${barHeight}%"></span>`).join("")}
            </div>
          </div>
          <div class="popup-shadow">
            <div class="popup-doc" aria-label="Utility Energy Downloader popup">
              ${popupMarkup}
            </div>
          </div>
        </div>
      </section>
    </main>
    <script>${stateScript}<\/script>
  </body>
</html>`;
}

function extractPopupMarkup(html) {
  const match = html.match(/<main class="panel">[\s\S]*?<\/main>/);
  if (!match) {
    throw new Error("Could not find popup panel markup in src/popup.html.");
  }
  return match[0];
}

function applyState(state) {
  for (const [selector, value] of Object.entries(state)) {
    const element = document.querySelector(`.popup-doc ${selector}`);
    if (!element) continue;
    if (typeof value === "string") {
      if ("value" in element && element.tagName === "INPUT") {
        element.value = value;
      } else {
        element.textContent = value;
      }
      continue;
    }
    if (value.text !== undefined) element.textContent = value.text;
    if (value.value !== undefined && "value" in element) element.value = value.value;
    for (const [name, propertyValue] of Object.entries(value.properties || {})) {
      element[name] = propertyValue;
    }
    for (const [name, attributeValue] of Object.entries(value.attributes || {})) {
      element.setAttribute(name, attributeValue);
    }
    for (const [name, styleValue] of Object.entries(value.style || {})) {
      element.style[name] = styleValue;
    }
  }
  for (const label of document.querySelectorAll(".popup-doc .progress-row span")) {
    if (label.textContent === "Intervals") label.textContent = "Data points";
  }
}

function removeDarkModeBlock(css) {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  if (start === -1) return css;
  const open = css.indexOf("{", start);
  if (open === -1) return css;
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return `${css.slice(0, start)}${css.slice(index + 1)}`;
  }
  return css;
}

function scopeCss(css, scope) {
  return css.replace(/(^|})\s*([^{}@][^{}]*)\{/g, (match, close, selectors) => {
    const scopedSelectors = selectors
      .split(",")
      .map(selector => scopeSelector(selector.trim(), scope))
      .join(",\n");
    return `${close}\n${scopedSelectors} {`;
  });
}

function scopeSelector(selector, scope) {
  if (!selector) return selector;
  if (selector === ":root" || selector === "body") return scope;
  if (selector === "*") return `${scope} *`;
  return `${scope} ${selector}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
