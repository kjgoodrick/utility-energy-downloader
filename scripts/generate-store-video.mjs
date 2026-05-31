#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outputDir = process.env.STORE_VIDEO_DIR
  ? resolve(process.env.STORE_VIDEO_DIR)
  : join(repoRoot, "release", "chrome-web-store", "videos");
const width = Number(process.env.STORE_VIDEO_WIDTH || 1280);
const height = Number(process.env.STORE_VIDEO_HEIGHT || 720);
const durationSeconds = Number(process.env.STORE_VIDEO_SECONDS || 32);
const outputPath = join(outputDir, "utility-energy-downloader-demo.mp4");
const posterPath = join(outputDir, "utility-energy-downloader-demo-poster.png");
const tempDir = join(outputDir, ".tmp-video");
const musicPath = process.env.STORE_VIDEO_MUSIC
  ? resolve(process.env.STORE_VIDEO_MUSIC)
  : join(outputDir, "mixkit-new-bass-01-720.mp3");

const popupHtml = readFileSync(join(repoRoot, "src", "popup.html"), "utf8");
const popupCss = readFileSync(join(repoRoot, "src", "popup.css"), "utf8");
const popupMarkup = extractPopupMarkup(popupHtml);
const scopedPopupCss = scopeCss(removeDarkModeBlock(popupCss), ".popup-doc");
const brandMarkData = readFileSync(join(repoRoot, "docs", "store-mark.svg")).toString("base64");
const brandMarkSrc = `data:image/svg+xml;base64,${brandMarkData}`;

mkdirSync(outputDir, { recursive: true });
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

const browser = await launchBrowser();
try {
  await writePoster(browser);
  const webmPath = await recordWebm(browser);
  transcode(webmPath, outputPath);
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${posterPath}`);
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}

async function writePoster(browser) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: "light"
  });
  try {
    await page.setContent(renderVideoPage(), { waitUntil: "load" });
    await page.evaluate(() => window.__setDemoTime(18.8));
    writeFileSync(posterPath, await page.screenshot({ fullPage: false, omitBackground: false }));
  } finally {
    await page.close();
  }
}

async function recordWebm(browser) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    recordVideo: {
      dir: tempDir,
      size: { width, height }
    }
  });
  const page = await context.newPage();
  try {
    await page.setContent(renderVideoPage(), { waitUntil: "load" });
    await page.waitForTimeout(durationSeconds * 1000);
    const video = page.video();
    await page.close();
    const recordedPath = await video.path();
    const webmPath = join(tempDir, "utility-energy-downloader-demo.webm");
    renameSync(recordedPath, webmPath);
    return webmPath;
  } finally {
    await context.close();
  }
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
        `Could not launch a browser for store video. Run "npx playwright install chromium" or set CHROME_BIN.\n\nBundled Chromium error:\n${bundledError.message}\n\nChrome error:\n${chromeError.message}`
      );
    }
  }
}

function transcode(inputPath, targetPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Playwright did not write a video at ${inputPath}.`);
  }
  const fadeStart = Math.max(0, durationSeconds - 5);
  const args = [
    "-y",
    "-i", inputPath
  ];
  if (existsSync(musicPath)) {
    args.push(
      "-i", musicPath,
      "-filter_complex", `[1:a]atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart}:d=5[a]`,
      "-map", "0:v:0",
      "-map", "[a]",
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      "-shortest"
    );
  } else {
    args.push(
      "-an",
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart"
    );
  }
  args.push(targetPath);
  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Could not run ffmpeg: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${result.status}.`);
  }
}

function renderVideoPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Utility Energy Downloader demo video</title>
    <style>
      :root {
        color: #15191f;
        background: #f2eee7;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-synthesis: none;
        text-rendering: optimizeLegibility;
        font-variant-numeric: tabular-nums;
      }

      * {
        box-sizing: border-box;
      }

      body {
        width: ${width}px;
        height: ${height}px;
        margin: 0;
        overflow: hidden;
        background:
          linear-gradient(118deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.18)),
          #f2eee7;
      }

      .stage {
        display: grid;
        grid-template-columns: 408px minmax(0, 1fr);
        gap: 36px;
        width: 100%;
        height: 100%;
        padding: 36px 58px 34px;
      }

      .copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        padding-bottom: 14px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 13px;
        margin-bottom: 34px;
        color: #3d444f;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .brand img {
        width: 46px;
        height: 46px;
        flex: 0 0 auto;
      }

      .eyebrow {
        min-height: 24px;
        margin: 0 0 12px;
        color: #4e79a7;
        font-size: 18px;
        font-weight: 800;
      }

      h1 {
        min-height: 154px;
        margin: 0;
        color: #111418;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        font-size: 48px;
        font-weight: 750;
        line-height: 1.06;
        letter-spacing: 0;
      }

      .lede {
        min-height: 96px;
        margin: 20px 0 0;
        color: #444d59;
        font-size: 20px;
        line-height: 1.38;
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        min-height: 76px;
        margin-top: 28px;
      }

      .badge {
        align-self: flex-start;
        border: 1px solid rgba(17, 20, 24, 0.13);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.66);
        color: #29313a;
        padding: 8px 12px;
        font-size: 14px;
        font-weight: 750;
        white-space: nowrap;
      }

      .privacy-strip {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-top: 28px;
        color: #59626f;
        font-size: 14px;
        font-weight: 700;
      }

      .privacy-strip span {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: #5f8f5f;
      }

      .visual {
        position: relative;
        min-width: 0;
        align-self: center;
      }

      .browser {
        height: 626px;
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
        height: 42px;
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
        height: 584px;
        background: #f8f8f9;
      }

      .utility-page {
        display: grid;
        gap: 16px;
        padding: 28px;
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

      .usage-card,
      .csv-preview,
      .analyzer-card {
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
      }

      .usage-card {
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
        height: 188px;
        border: 1px solid #ececee;
        border-radius: 8px;
        background: #ffffff;
        padding: 18px;
      }

      .bar {
        flex: 1;
        min-width: 0;
        border-radius: 5px 5px 0 0;
        background: #4e79a7;
        opacity: 0.58;
        transform-origin: bottom;
        transition: height 260ms ease, background 260ms ease;
      }

      .csv-preview {
        position: absolute;
        left: 28px;
        right: 414px;
        bottom: 25px;
        padding: 14px;
        opacity: 0;
        transform: translateY(18px);
        transition: opacity 280ms ease, transform 280ms ease;
      }

      .csv-preview strong,
      .analyzer-card strong {
        display: block;
        margin-bottom: 8px;
        color: #242931;
        font-size: 15px;
      }

      .csv-preview code {
        display: grid;
        gap: 5px;
        color: #4b5460;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.35;
      }

      .analyzer-card {
        position: absolute;
        left: 28px;
        right: 414px;
        bottom: 25px;
        padding: 16px;
        opacity: 0;
        transform: translateY(18px);
        transition: opacity 280ms ease, transform 280ms ease;
      }

      .rate-bars {
        display: grid;
        gap: 8px;
      }

      .rate-row {
        display: grid;
        grid-template-columns: 62px minmax(0, 1fr) 54px;
        gap: 8px;
        align-items: center;
        color: #515b68;
        font-size: 12px;
        font-weight: 700;
      }

      .rate-meter {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: #ececee;
      }

      .rate-meter span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #5f8f5f;
      }

      .popup-shadow {
        position: absolute;
        right: 24px;
        bottom: 25px;
        width: 360px;
        border-radius: 8px;
        box-shadow: 0 22px 60px rgba(17, 20, 24, 0.28);
        overflow: hidden;
        transform-origin: top right;
        transition: transform 280ms ease, box-shadow 280ms ease;
      }

      ${scopedPopupCss}

      .popup-doc [hidden] {
        display: none !important;
      }

      .popup-doc header h1,
      .popup-doc h2 {
        min-height: 0;
      }

      .popup-doc .panel {
        gap: 12px;
      }

      .popup-doc .actions {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .popup-doc .date-grid label.is-active input {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
      }

      .calendar-popover {
        position: absolute;
        right: 148px;
        top: 356px;
        z-index: 21;
        width: 232px;
        border: 1px solid rgba(17, 20, 24, 0.12);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 34px rgba(60, 50, 38, 0.14);
        padding: 12px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 240ms ease, transform 240ms ease;
      }

      body[data-calendar="1"] .calendar-popover {
        opacity: 1;
        transform: translateY(0);
      }

      .calendar-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #242931;
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 10px;
      }

      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 3px;
        color: #59626f;
        font-size: 11px;
        text-align: center;
      }

      .calendar-grid span {
        display: grid;
        place-items: center;
        min-height: 22px;
        border-radius: 5px;
      }

      .calendar-grid .weekday {
        min-height: 16px;
        color: #8a929d;
        font-size: 10px;
        font-weight: 800;
      }

      .calendar-grid .muted {
        color: #c3c7ce;
      }

      .calendar-grid .selected {
        background: var(--accent);
        color: #ffffff;
        font-weight: 800;
      }

      .tap-ring {
        position: absolute;
        z-index: 20;
        width: 26px;
        height: 26px;
        border: 2px solid var(--accent);
        border-radius: 999px;
        pointer-events: none;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.6);
      }

      body[data-click="1"] .tap-ring {
        animation: tapRing 620ms ease-out;
      }

      @keyframes tapRing {
        0% {
          opacity: 0.75;
          transform: translate(-50%, -50%) scale(0.4);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(2.2);
        }
      }

      body[data-phase="csv"] .csv-preview,
      body[data-phase="analyzer"] .analyzer-card {
        opacity: 1;
        transform: translateY(0);
      }

    </style>
  </head>
  <body>
    <main class="stage">
      <section class="copy" aria-label="Demo caption">
        <div class="brand">
          <img alt="" src="${brandMarkSrc}">
          <span>Utility Energy Downloader</span>
        </div>
        <p id="eyebrow" class="eyebrow"></p>
        <h1 id="headline"></h1>
        <p id="lede" class="lede"></p>
        <div id="badges" class="badges"></div>
        <div class="privacy-strip"><span></span>No passwords. No backend service. No analytics.</div>
      </section>

      <section class="visual" aria-label="Animated extension demo">
        <div class="browser">
          <div class="chrome">
            <div class="dots" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
            <div class="url">yourutility.com/energy-usage</div>
          </div>
          <div class="browser-body">
            <div class="utility-page">
              <div class="utility-header">
                <h2 class="utility-title">Energy usage</h2>
                <span id="utility-date" class="utility-date">May 12, 2026</span>
              </div>
              <div class="usage-grid">
                <div class="usage-card"><span>Total usage</span><strong id="usage-total">31.8 kWh</strong></div>
                <div class="usage-card"><span>Peak demand</span><strong id="usage-peak">4.2 kW</strong></div>
              </div>
              <div id="chart" class="chart" aria-hidden="true"></div>
            </div>
            <div class="csv-preview" aria-label="CSV export preview">
              <strong>energy-usage-timeseries.csv</strong>
              <code>
                <span>timestamp_local,usage_kwh</span>
                <span>2026-05-12T00:00:00-06:00,0.42</span>
                <span>2026-05-12T00:30:00-06:00,0.38</span>
                <span>2026-05-12T01:00:00-06:00,0.35</span>
              </code>
            </div>
            <div class="analyzer-card" aria-label="Rate analyzer preview">
              <strong>Local Time-of-Use comparison</strong>
              <div class="rate-bars">
                <div class="rate-row"><span>Current</span><span class="rate-meter"><span style="width: 88%"></span></span><span>$142</span></div>
                <div class="rate-row"><span>TOU</span><span class="rate-meter"><span style="width: 68%"></span></span><span>$110</span></div>
                <div class="rate-row"><span>Shifted</span><span class="rate-meter"><span style="width: 55%"></span></span><span>$89</span></div>
              </div>
            </div>
            <div class="popup-shadow">
              <div class="popup-doc" aria-label="Utility Energy Downloader popup">
                ${popupMarkup}
              </div>
            </div>
            <div class="calendar-popover" aria-label="Calendar date picker">
              <div class="calendar-head"><span>May 2024</span><span>Start date</span></div>
              <div class="calendar-grid">
                <span class="weekday">S</span><span class="weekday">M</span><span class="weekday">T</span><span class="weekday">W</span><span class="weekday">T</span><span class="weekday">F</span><span class="weekday">S</span>
                <span class="muted">28</span><span class="muted">29</span><span class="muted">30</span><span>1</span><span>2</span><span>3</span><span>4</span>
                <span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span><span>11</span>
                <span class="selected">12</span><span>13</span><span>14</span><span>15</span><span>16</span><span>17</span><span>18</span>
                <span>19</span><span>20</span><span>21</span><span>22</span><span>23</span><span>24</span><span>25</span>
                <span>26</span><span>27</span><span>28</span><span>29</span><span>30</span><span>31</span><span class="muted">1</span>
              </div>
            </div>
            <div id="tap-ring" class="tap-ring" aria-hidden="true"></div>
          </div>
        </div>
      </section>
    </main>
    <script>
      (${videoScript.toString()})(${JSON.stringify({
        barHeights: [42, 58, 47, 69, 76, 63, 88, 71, 52, 60, 79, 93, 67, 55, 73, 84, 61, 49, 66, 78, 57, 44, 53, 64]
      })});
    <\/script>
  </body>
</html>`;
}

function videoScript(options) {
  const body = document.body;
  const root = document.querySelector(".popup-doc");
  const chart = document.querySelector("#chart");
  const tapRing = document.querySelector("#tap-ring");
  const bars = options.barHeights.map((height) => {
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.height = `${height}%`;
    chart.append(bar);
    return bar;
  });
  const text = {
    eyebrow: document.querySelector("#eyebrow"),
    headline: document.querySelector("#headline"),
    lede: document.querySelector("#lede"),
    badges: document.querySelector("#badges"),
    utilityDate: document.querySelector("#utility-date"),
    usageTotal: document.querySelector("#usage-total"),
    usagePeak: document.querySelector("#usage-peak")
  };
  const elements = {
    status: root.querySelector("#status"),
    startDate: root.querySelector("#start-date"),
    endDate: root.querySelector("#end-date"),
    progressBar: root.querySelector(".progress-bar"),
    progressFill: root.querySelector("#progress-fill"),
    progressCount: root.querySelector("#progress-count"),
    eta: root.querySelector("#eta"),
    daysSaved: root.querySelector("#days-saved"),
    rowsSaved: root.querySelector("#rows-saved"),
    currentDay: root.querySelector("#current-day"),
    start: root.querySelector("#start"),
    resume: root.querySelector("#resume"),
    pause: root.querySelector("#pause"),
    openUtility: root.querySelector("#open-utility"),
    exportCsv: root.querySelector("#export-csv"),
    clearData: root.querySelector("#clear-data"),
    bridge: root.querySelector("#bridge"),
    bridgeStatus: root.querySelector("#bridge-status"),
    approveShare: root.querySelector("#approve-share"),
    declineShare: root.querySelector("#decline-share")
  };
  const primaryActions = root.querySelector('.actions[aria-label="Download controls"]');
  const secondaryActions = root.querySelector(".actions.secondary");
  elements.openUtility?.remove();
  primaryActions?.append(elements.exportCsv, elements.clearData);
  secondaryActions?.remove();
  const scenes = [
    {
      start: 0,
      end: 7.0,
      phase: "ready",
      eyebrow: "Local utility session",
      headline: "Download detailed energy usage",
      lede: "Choose the dates from the utility usage page and start a local capture without sharing account credentials.",
      badges: ["Runs after login", "No password access", "Local storage"],
      accent: "#4e79a7"
    },
    {
      start: 7.0,
      end: 15.5,
      phase: "running",
      eyebrow: "Resumable capture",
      headline: "Capture each day with checkpoints",
      lede: "The downloader steps through the date range, saves completed days independently, and keeps progress visible.",
      badges: ["Daily checkpoints", "Pause anytime", "Resume later"],
      accent: "#5f8f5f"
    },
    {
      start: 15.5,
      end: 23.5,
      phase: "csv",
      eyebrow: "CSV export",
      headline: "Export clean interval data",
      lede: "When the run finishes, export a sanitized CSV with timestamps and usage values for spreadsheets or rate checks.",
      badges: ["Spreadsheet-ready", "Sanitized fields", "Offline file"],
      accent: "#c9933a"
    },
    {
      start: 23.5,
      end: 33.0,
      phase: "analyzer",
      eyebrow: "Explicit approval",
      headline: "Share with the analyzer only when you approve",
      lede: "The Time-of-Use Rate Analyzer can import the local CSV only after you approve the waiting request.",
      badges: ["Approval gate", "Local handoff", "No servers"],
      accent: "#7f6aa3"
    }
  ];

  let forcedTime = null;
  let startTime = performance.now();
  let lastScene = "";
  let clickToken = 0;

  window.__setDemoTime = (seconds) => {
    forcedTime = seconds;
    update(seconds);
  };

  function frame(now) {
    if (forcedTime === null) {
      update((now - startTime) / 1000);
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);

  function update(seconds) {
    const scene = scenes.find((item) => seconds >= item.start && seconds < item.end) || scenes[scenes.length - 1];
    const local = clamp((seconds - scene.start) / (scene.end - scene.start), 0, 1);
    body.dataset.phase = scene.phase;
    body.dataset.calendar = scene.phase === "ready" && local > 0.18 && local < 0.58 ? "1" : "0";
    if (scene.phase !== lastScene) {
      lastScene = scene.phase;
      renderSceneText(scene);
      if (forcedTime === null) {
        pulseClick();
      } else {
        body.dataset.click = "0";
      }
    }
    document.documentElement.style.setProperty("--accent", scene.accent);
    bars.forEach((bar, index) => {
      const base = options.barHeights[index];
      const lift = scene.phase === "running" ? Math.sin(seconds * 2.3 + index * 0.7) * 7 : 0;
      bar.style.height = `${Math.max(18, Math.min(96, base + lift))}%`;
      bar.style.background = scene.accent;
    });
    renderPopup(scene.phase, local, scene.accent);
  }

  function renderSceneText(scene) {
    text.eyebrow.textContent = scene.eyebrow;
    text.eyebrow.style.color = scene.accent;
    text.headline.textContent = scene.headline;
    text.lede.textContent = scene.lede;
    text.badges.replaceChildren(...scene.badges.map((label) => {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = label;
      return badge;
    }));
  }

  function renderPopup(phase, local, accent) {
    root.style.setProperty("--accent", accent);
    elements.startDate.value = phase === "ready" && local < 0.58 ? "2025-05-12" : "2024-05-12";
    elements.endDate.value = "2026-05-12";
    elements.exportCsv.hidden = phase === "ready" || phase === "running";
    elements.clearData.hidden = phase === "ready" || phase === "running";
    elements.bridge.hidden = phase !== "analyzer";
    elements.approveShare.disabled = phase !== "analyzer";
    elements.declineShare.disabled = phase !== "analyzer";
    elements.bridgeStatus.textContent = "Share locally stored energy interval CSV with the Time-of-Use Rate Analyzer at https://offpeakadvisor.com. This request is from https://offpeakadvisor.com for 35,088 saved intervals.";

    let progress = 0;
    let days = 0;
    let rows = 0;
    let eta = "-";
    let currentDay = "-";
    let status = "Ready on the utility energy usage page.";
    const activeDate = phase === "ready" && local > 0.18 && local < 0.58 ? "start" : "";

    if (phase === "ready") {
      progress = 0;
      days = 0;
      rows = 0;
      eta = "-";
      currentDay = "-";
      status = local > 0.18 && local < 0.58 ? "Ready. Select the download range." : "Ready on the utility energy usage page.";
      elements.start.hidden = false;
      elements.resume.hidden = true;
      elements.pause.hidden = true;
      elements.exportCsv.disabled = true;
    } else if (phase === "running") {
      progress = Math.round(4 + local * 50);
      days = Math.round(28 + local * 366);
      rows = days * 48;
      eta = local < 0.58 ? "about 32 min left" : "about 18 min left";
      currentDay = addDays("2024-06-09", Math.round(local * 366));
      status = "Downloading usage data. You can close this popup.";
      elements.start.hidden = true;
      elements.resume.hidden = true;
      elements.pause.hidden = false;
      elements.exportCsv.disabled = true;
      text.utilityDate.textContent = local < 0.5 ? "Nov 04, 2025" : "Jan 18, 2026";
      text.usageTotal.textContent = local < 0.5 ? "24.6 kWh" : "42.1 kWh";
      text.usagePeak.textContent = local < 0.5 ? "3.7 kW" : "5.1 kW";
    } else {
      progress = 100;
      days = 731;
      rows = 35088;
      eta = "complete";
      currentDay = "-";
      status = phase === "csv" ? "Download complete." : "Ready. Saved data is available.";
      elements.start.hidden = true;
      elements.resume.hidden = true;
      elements.pause.hidden = true;
      elements.exportCsv.disabled = false;
    }

    elements.status.textContent = status;
    elements.progressFill.style.width = `${progress}%`;
    elements.progressBar.setAttribute("aria-valuenow", String(progress));
    elements.progressCount.textContent = `${days} of 731 days`;
    elements.eta.textContent = eta;
    elements.daysSaved.textContent = formatNumber(days);
    elements.rowsSaved.textContent = formatNumber(rows);
    elements.currentDay.textContent = currentDay;
    elements.startDate.closest("label").classList.toggle("is-active", activeDate === "start");
    elements.endDate.closest("label").classList.toggle("is-active", activeDate === "end");
  }

  function pulseClick() {
    clickToken += 1;
    const positions = {
      ready: [528, 324],
      running: [604, 324],
      csv: [514, 366],
      analyzer: [514, 454]
    };
    const phase = body.dataset.phase || "ready";
    const [left, top] = positions[phase] || positions.ready;
    tapRing.style.left = `${left}px`;
    tapRing.style.top = `${top}px`;
    body.dataset.click = "1";
    const token = clickToken;
    setTimeout(() => {
      if (token === clickToken) body.dataset.click = "0";
    }, 540);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function addDays(isoDate, amount) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
}

function extractPopupMarkup(html) {
  const match = html.match(/<main class="panel">[\s\S]*?<\/main>/);
  if (!match) {
    throw new Error("Could not find popup panel markup in src/popup.html.");
  }
  return match[0];
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
