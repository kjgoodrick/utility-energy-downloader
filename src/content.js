(() => {
  "use strict";

  const HOOK_SOURCE = "energy-usage-downloader";
  const STORAGE_JOB_KEY = "energy.job";
  const STORAGE_META_KEY = "energy.meta";
  const PENDING_SHARE_KEY = "energy.share.pending";
  const SHARE_GRANTS_KEY = "energy.share.grants";
  const DAY_KEY_PREFIX = "energy.day.";
  const DATE_INPUT_SELECTOR = 'input[placeholder="Show usage through :"]';
  const PERIOD_OPTION_LABEL = "One Day";
  const LOADING_SELECTOR = "#loading-component, .overlay";
  const REQUEST_TIMEOUT_MS = 45_000;
  const READY_TIMEOUT_MS = 30_000;
  const MAX_ATTEMPTS_PER_DAY = 3;
  // Small jitter keeps retries from hammering the utility page if it is slow.
  const MIN_DELAY_MS = 2_000;
  const MAX_DELAY_MS = 6_000;
  const PANEL_ID = "energy-usage-downloader-panel";
  const { timestampLocal } = globalThis.energyUsageTime;

  let activeRun = null;
  // These separate "what happened in this page session" from older persisted
  // jobs, which prevents stale complete states from showing as fresh activity.
  let sessionJobId = null;
  let sessionCompletedJobId = null;
  const pendingUsageWaiters = new Set();

  // All data stays in the browser profile's local extension storage. There is
  // no remote service involved in download state, cached rows, or exports.
  const storage = {
    async get(keys) {
      return chrome.storage.local.get(keys);
    },
    async set(values) {
      return chrome.storage.local.set(values);
    },
    async remove(keys) {
      return chrome.storage.local.remove(keys);
    }
  };

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgoIso(count) {
    const date = new Date();
    date.setDate(date.getDate() - count);
    return date.toISOString().slice(0, 10);
  }

  function dayKey(day) {
    return `${DAY_KEY_PREFIX}${day}`;
  }

  function createJobId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomDelay() {
    return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseIsoDay(day) {
    const date = new Date(`${day}T00:00:00`);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`Invalid date: ${day}`);
    }
    return date;
  }

  function addDays(day, count) {
    const date = parseIsoDay(day);
    date.setDate(date.getDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function enumerateDays(start, end) {
    const days = [];
    let current = start;
    while (current <= end) {
      days.push(current);
      current = addDays(current, 1);
    }
    return days;
  }

  function formatUtilityDate(day) {
    const date = parseIsoDay(day);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "less than a minute";

    const totalSeconds = Math.max(1, Math.round(ms / 1000));
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours && parts.length < 2) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes && parts.length < 2) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (!parts.length) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
    return parts.join(", ");
  }

  function normalizeReadDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
    }
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    }
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }

  function friendlyErrorMessage(errorText) {
    const text = String(errorText || "");
    if (!text) return "";

    if (isPageResponseError(text)) {
      return "The utility page stopped responding, so the download paused. Everything downloaded so far is saved on this computer. Try refreshing the energy usage page, make sure you are still logged in, then click Resume. Utility websites can sometimes get bogged down; if it still will not continue, wait an hour or so and try Resume again.";
    }

    if (text.includes("returned no interval rows")) {
      return `${text}. You can try refreshing the energy usage page and clicking Resume.`;
    }

    return text;
  }

  function isPageResponseError(errorText) {
    const text = String(errorText || "");
    return text.includes("Timed out waiting for usage data")
      || text.includes("Could not find the utility usage date input")
      || text.includes("Could not find the utility usage period selector");
  }

  function normalizeUsageRows(intervalRows) {
    if (!Array.isArray(intervalRows)) return [];

    const seenReadTimes = new Map();
    return intervalRows
      .map((item, index) => {
        const readDateIso = normalizeReadDate(item.readDate);
        const usage = Number(item.usage);
        const readTimeKey = `${readDateIso || ""} ${item.readTime || ""}`;
        const readTimeOccurrence = (seenReadTimes.get(readTimeKey) || 0) + 1;
        seenReadTimes.set(readTimeKey, readTimeOccurrence);
        return {
          // Fall daylight-saving transitions can repeat a local clock time.
          // Keep both a sequence number and an occurrence count so exports do
          // not collapse two real intervals onto one ambiguous timestamp.
          interval_index: index + 1,
          read_date: item.readDate ?? null,
          read_date_iso: readDateIso,
          read_time: item.readTime ?? null,
          read_time_occurrence: readTimeOccurrence,
          timestamp_local: timestampLocal(readDateIso, item.readTime),
          usage_kwh: Number.isFinite(usage) ? usage : null
        };
      })
      .filter(row => row.read_date_iso && row.read_time && row.timestamp_local);
  }

  function captureMatchesDay(capture, day) {
    const rows = normalizeUsageRows(capture?.rows);
    return rows.some(row => row.read_date_iso === day)
      ? { rows }
      : null;
  }

  function getVisibleDateField() {
    const fields = Array.from(document.querySelectorAll(DATE_INPUT_SELECTOR));
    return fields.find(field => field.offsetParent !== null) || fields[0] || null;
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden";
  }

  function controlText(element) {
    const optionText = element instanceof HTMLSelectElement
      ? Array.from(element.options).map(option => `${option.textContent || ""} ${option.value || ""}`).join(" ")
      : "";
    return [
      element.value,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      optionText
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function getVisiblePeriodControl() {
    // The utility page has used Angular Material controls, but the code also
    // supports a plain select so the downloader is not tied to one DOM shape.
    const candidates = Array.from(document.querySelectorAll([
      "select",
      "mat-select",
      '[role="combobox"]',
      '[role="listbox"]',
      "button",
      "input[readonly]"
    ].join(",")));

    return candidates.find(element => {
      const text = controlText(element);
      return isVisible(element) && (text.includes("one day") || text.includes("one month"));
    }) || null;
  }

  async function waitForDateField(timeoutMs = READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const field = getVisibleDateField();
      if (field) return field;
      await sleep(500);
    }
    throw new Error("Could not find the utility usage date input. Open the energy usage page first.");
  }

  async function waitForPeriodControl(timeoutMs = READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const control = getVisiblePeriodControl();
      if (control) return control;
      await sleep(500);
    }
    throw new Error("Could not find the utility usage period selector. Open the energy usage page first.");
  }

  async function waitForLoadingToFinish(timeoutMs = READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const loading = Array.from(document.querySelectorAll(LOADING_SELECTOR)).some(element => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
      });
      if (!loading) return;
      await sleep(250);
    }
  }

  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  async function selectOneDayPeriod() {
    await waitForLoadingToFinish();
    const control = await waitForPeriodControl();
    const currentText = controlText(control);
    if (currentText.includes("one day") && !currentText.includes("one month")) {
      return false;
    }

    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find(candidate => {
        const text = `${candidate.textContent || ""} ${candidate.value || ""}`.toLowerCase();
        return text.includes("one day");
      });
      if (!option) {
        throw new Error("Could not find the One Day period option.");
      }

      setNativeValue(control, option.value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      await waitForLoadingToFinish();
      return true;
    }

    control.scrollIntoView({ block: "center", inline: "nearest" });
    control.focus();
    control.click();
    await sleep(300);

    const option = Array.from(document.querySelectorAll('mat-option, [role="option"], li, button, div, span'))
      .find(element => {
        const text = element.textContent?.trim().toLowerCase();
        return isVisible(element) && text === PERIOD_OPTION_LABEL.toLowerCase();
      });
    if (!option) {
      throw new Error("Could not find the One Day period option.");
    }

    option.click();
    await waitForLoadingToFinish();
    return true;
  }

  function fieldValueIsoDay(field) {
    return normalizeReadDate(field.value);
  }

  async function applyUsageDate(day) {
    await waitForLoadingToFinish();
    const field = await waitForDateField();
    field.scrollIntoView({ block: "center", inline: "nearest" });
    field.focus();
    field.click();
    setNativeValue(field, formatUtilityDate(day));
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    return field;
  }

  async function setUsageDate(day) {
    const field = await waitForDateField();
    if (fieldValueIsoDay(field) === day) {
      // Re-selecting the same date often does not trigger a new network
      // request, so briefly move away and back to force the page to reload data.
      await applyUsageDate(addDays(day, -1));
      await waitForLoadingToFinish(10_000);
      await sleep(500);
    }
    await applyUsageDate(day);
  }

  function waitForUsageCapture(day, timeoutMs = REQUEST_TIMEOUT_MS) {
    let waiter = null;
    const promise = new Promise((resolve, reject) => {
      waiter = {
        day,
        resolve,
        reject,
        timeoutId: window.setTimeout(() => {
          pendingUsageWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for usage data for ${day}`));
        }, timeoutMs)
      };
      pendingUsageWaiters.add(waiter);
    });

    return {
      promise,
      cancel() {
        if (!waiter || !pendingUsageWaiters.has(waiter)) return;
        window.clearTimeout(waiter.timeoutId);
        pendingUsageWaiters.delete(waiter);
      }
    };
  }

  function handleCapturedUsage(capture) {
    // A page response may arrive while more than one request attempt is waiting.
    // Resolve only waiters whose normalized rows actually include the target day.
    for (const waiter of Array.from(pendingUsageWaiters)) {
      const match = captureMatchesDay(capture, waiter.day);
      if (!match) continue;

      window.clearTimeout(waiter.timeoutId);
      pendingUsageWaiters.delete(waiter);
      waiter.resolve({
        day: waiter.day,
        status: capture.status,
        capturedAt: capture.capturedAt,
        rows: match.rows
      });
    }
  }

  async function readJob() {
    const values = await storage.get(STORAGE_JOB_KEY);
    return values[STORAGE_JOB_KEY] || null;
  }

  async function writeJob(job) {
    const next = {
      ...job,
      updatedAt: new Date().toISOString()
    };
    await storage.set({ [STORAGE_JOB_KEY]: next });
    return next;
  }

  async function markDayDone(day, capture) {
    await storage.set({
      [dayKey(day)]: {
        status: "done",
        day,
        statusCode: capture.status,
        capturedAt: capture.capturedAt,
        rows: capture.rows
      }
    });
  }

  async function markDayFailed(day, error, attempt) {
    const existing = (await storage.get(dayKey(day)))[dayKey(day)] || {};
    await storage.set({
      [dayKey(day)]: {
        ...existing,
        status: "failed",
        day,
        attempt,
        error: error.message || String(error),
        failedAt: new Date().toISOString()
      }
    });
  }

  async function isDayDone(day) {
    const values = await storage.get(dayKey(day));
    return values[dayKey(day)]?.status === "done";
  }

  async function requestDay(day) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_DAY; attempt += 1) {
      let usageWait = null;
      try {
        usageWait = waitForUsageCapture(day);
        await selectOneDayPeriod();
        await setUsageDate(day);
        const capture = await usageWait.promise;
        if (!capture.rows.length) {
          throw new Error(`The utility returned no interval rows for ${day}`);
        }
        await markDayDone(day, capture);
        return capture;
      } catch (error) {
        usageWait?.cancel();
        lastError = error;
        await markDayFailed(day, error, attempt);
        await sleep(Math.min(30_000, 2_000 * attempt * attempt));
      }
    }
    throw lastError || new Error(`Failed to download ${day}`);
  }

  async function summarizeStoredData() {
    const all = await storage.get(null);
    const days = Object.entries(all)
      .filter(([key]) => key.startsWith(DAY_KEY_PREFIX))
      .map(([, value]) => value);

    const doneDays = days.filter(day => day.status === "done");
    const failedDays = days.filter(day => day.status === "failed");
    const rows = doneDays.reduce((count, day) => count + (day.rows?.length || 0), 0);
    const job = all[STORAGE_JOB_KEY] || null;
    const isSessionJob = Boolean(job?.jobId && (job.jobId === sessionJobId || job.jobId === sessionCompletedJobId));
    const isRunningNow = Boolean(job?.status === "running" && activeRun && isSessionJob);
    // Paused jobs remain actionable after a refresh, so they intentionally do
    // not require this page session's job id.
    const isPausedNow = Boolean(job?.status === "paused");
    const isCompleteNow = Boolean(job?.status === "complete" && isSessionJob);
    const isInterrupted = Boolean(job?.status === "running" && !activeRun);
    const showActiveProgress = isRunningNow || isPausedNow || isCompleteNow || isInterrupted;
    const jobDays = job?.startDate && job?.endDate ? enumerateDays(job.startDate, job.endDate) : [];
    const jobDaySet = new Set(jobDays);
    const completedInJob = jobDays.length
      ? doneDays.filter(day => jobDaySet.has(day.day)).length
      : doneDays.length;
    const totalDays = job?.totalDays || jobDays.length || 0;
    const displayedCompletedDays = showActiveProgress ? completedInJob : 0;
    const displayedTotalDays = showActiveProgress ? totalDays : 0;
    const progressPercent = displayedTotalDays ? clamp((displayedCompletedDays / displayedTotalDays) * 100, 0, 100) : 0;
    const startedAtMs = Date.parse(job?.startedAt || "");
    const elapsedMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : null;
    const remainingDays = Math.max(0, displayedTotalDays - displayedCompletedDays);
    const etaMs = isRunningNow && elapsedMs && displayedCompletedDays > 0 && remainingDays > 0
      ? (elapsedMs / displayedCompletedDays) * remainingDays
      : null;
    const etaText = isCompleteNow
      ? "Done"
      : isRunningNow && displayedTotalDays > 0 && remainingDays === 0
        ? "Finishing up"
      : isRunningNow && etaMs
        ? `About ${formatDuration(etaMs)} left`
        : isRunningNow
          ? "Estimating after the first day"
          : "-";
    const lastErrorMessage = job?.lastErrorMessage || friendlyErrorMessage(job?.lastError);

    return {
      job,
      lastErrorMessage,
      display: {
        showActiveProgress,
        isRunningNow,
        isPausedNow,
        isCompleteNow,
        isInterrupted
      },
      doneDays: doneDays.length,
      failedDays: failedDays.length,
      rows,
      firstDay: doneDays.map(day => day.day).sort()[0] || null,
      lastDay: doneDays.map(day => day.day).sort().at(-1) || null,
      progress: {
        totalDays: displayedTotalDays,
        completedDays: displayedCompletedDays,
        remainingDays,
        percent: Math.round(progressPercent),
        elapsedText: showActiveProgress && elapsedMs ? formatDuration(elapsedMs) : "-",
        etaText
      },
      pageReady: Boolean(getVisibleDateField())
    };
  }

  function collectRowsFromStorageSnapshot(all) {
    const dayRecords = Object.entries(all)
      .filter(([key, value]) => key.startsWith(DAY_KEY_PREFIX) && value?.status === "done")
      .map(([, value]) => value)
      .sort((a, b) => a.day.localeCompare(b.day));

    return dayRecords.flatMap(record => record.rows || [])
      .sort((a, b) => String(a.timestamp_local).localeCompare(String(b.timestamp_local)));
  }

  function csvValue(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function rowsToCsv(rows) {
    const headers = ["timestamp_local", "interval_index", "read_date", "read_time", "read_time_occurrence", "usage_kwh"];
    return [
      headers.join(","),
      ...rows.map(row => headers.map(header => csvValue(header === "read_date" ? row.read_date_iso ?? row.read_date : row[header])).join(","))
    ].join("\n");
  }

  async function exportData() {
    const all = await storage.get(null);
    const rows = collectRowsFromStorageSnapshot(all);
    if (!rows.length) {
      throw new Error("No saved usage data is available to export.");
    }
    return {
      mime: "text/csv",
      extension: "csv",
      text: rowsToCsv(rows),
      filename: `energy-usage-timeseries-${todayIso()}.csv`
    };
  }

  function ensureInlinePanel() {
    if (document.getElementById(PANEL_ID)) return;
    if (!location.pathname.includes("/secure/my-account/energy-usage")) return;

    const host = document.createElement("div");
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          left: 16px;
          bottom: 16px;
          z-index: 2147483647;
          color-scheme: light;
          font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
          --bg: #ffffff;
          --panel: #ffffff;
          --panel-soft: #f7f7f8;
          --text: #1b1e23;
          --heading: #111418;
          --muted: #626875;
          --line: #ececee;
          --faint: #d9dadd;
          --accent: #4e79a7;
          --accent-2: #c9933a;
          --button-bg: #111418;
          --button-text: #ffffff;
          --danger-bg: #fff5f3;
          --danger-line: #f0b4ab;
          --danger-text: #9f342b;
          --font-display: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
          --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        .panel {
          width: 320px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--panel);
          box-shadow: 0 18px 48px rgb(17 20 24 / 0.18);
          color: var(--text);
          padding: 12px;
        }

        .header {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }

        h2 {
          margin: 0;
          color: var(--heading);
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0;
        }

        .status {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.35;
        }

        .collapse {
          border: 0;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font-family: var(--font-sans);
          font-size: 18px;
          line-height: 1;
          padding: 0 2px;
        }

        .grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 8px;
          margin-bottom: 8px;
        }

        label {
          display: grid;
          gap: 3px;
          min-width: 0;
          color: var(--accent-2);
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 650;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        input {
          min-width: 0;
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--panel);
          color: var(--text);
          font: inherit;
          font-family: var(--font-sans);
          font-size: 12px;
          letter-spacing: 0;
          padding: 6px;
          text-transform: none;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          margin-bottom: 8px;
        }

        .stat {
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 6px;
        }

        .stat span {
          display: block;
          color: var(--muted);
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 650;
        }

        .stat strong {
          display: block;
          margin-top: 2px;
          color: var(--heading);
          font-family: var(--font-sans);
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .progress-wrap {
          display: grid;
          gap: 5px;
          margin-bottom: 8px;
        }

        .progress-bar {
          height: 8px;
          overflow: hidden;
          border-radius: 999px;
          background: var(--panel-soft);
        }

        .progress-fill {
          width: 0%;
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
          transition: width 180ms ease;
        }

        .progress-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: var(--muted);
          font-family: var(--font-sans);
          font-size: 11px;
          line-height: 1.3;
        }

        .progress-count,
        .eta {
          min-width: 0;
        }

        .eta {
          text-align: right;
        }

        .actions {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }

        button.action {
          min-height: 30px;
          border: 1px solid var(--button-bg);
          border-radius: 6px;
          background: var(--button-bg);
          color: var(--button-text);
          cursor: pointer;
          font: inherit;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 700;
          padding: 4px 6px;
        }

        button.secondary {
          border-color: var(--line);
          background: var(--panel);
          color: var(--text);
        }

        .error {
          margin: 8px 0 0;
          border: 1px solid var(--danger-line);
          border-radius: 6px;
          background: var(--danger-bg);
          color: var(--danger-text);
          font-size: 11px;
          line-height: 1.35;
          padding: 6px;
        }

        .hidden {
          display: none;
        }

        .notice-backdrop {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgb(17 20 24 / 0.32);
          padding: 20px;
        }

        .notice {
          width: min(420px, calc(100vw - 40px));
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--panel);
          box-shadow: 0 24px 60px rgb(17 20 24 / 0.28);
          color: var(--text);
          padding: 18px;
        }

        .notice h3 {
          margin: 0;
          color: var(--heading);
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0;
        }

        .notice p {
          margin: 8px 0 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
        }

        .notice-actions {
          display: flex;
          justify-content: end;
          gap: 8px;
          margin-top: 16px;
        }

        .notice-actions button {
          min-height: 34px;
          border: 1px solid var(--button-bg);
          border-radius: 6px;
          background: var(--button-bg);
          color: var(--button-text);
          cursor: pointer;
          font: inherit;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 700;
          padding: 6px 12px;
        }

        .notice-actions button.secondary {
          border-color: var(--line);
          background: var(--panel);
          color: var(--text);
        }

        .notice-backdrop.hidden {
          display: none;
        }
      </style>
      <section class="panel">
        <div class="header">
          <div>
            <h2>Energy Downloader</h2>
            <p class="status">Checking page...</p>
          </div>
          <button class="collapse" title="Hide panel">x</button>
        </div>
        <div class="grid">
          <label>Start <input class="start" type="date"></label>
          <label>End <input class="end" type="date"></label>
        </div>
        <div class="stats">
          <div class="stat"><span>Days</span><strong class="days">0</strong></div>
          <div class="stat"><span>Intervals</span><strong class="rows">0</strong></div>
          <div class="stat"><span>Current</span><strong class="current">-</strong></div>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="progress-fill"></div>
          </div>
          <div class="progress-meta">
            <span class="progress-count">0 of 0 days</span>
            <span class="eta">-</span>
          </div>
        </div>
        <div class="actions">
          <button class="action start-button">Start</button>
          <button class="action secondary resume-button">Resume</button>
          <button class="action secondary pause-button">Pause</button>
        </div>
        <div class="error hidden"></div>
      </section>
      <div class="notice-backdrop hidden">
        <div class="notice" role="dialog" aria-modal="true" aria-labelledby="energy-paused-title">
          <h3 id="energy-paused-title">Download paused</h3>
          <p class="notice-message"></p>
          <div class="notice-actions">
            <button class="secondary notice-close">Close</button>
            <button class="notice-resume">Resume</button>
          </div>
        </div>
      </div>
    `;

    document.documentElement.append(host);

    const status = shadow.querySelector(".status");
    const error = shadow.querySelector(".error");
    const startInput = shadow.querySelector(".start");
    const endInput = shadow.querySelector(".end");
    const days = shadow.querySelector(".days");
    const rows = shadow.querySelector(".rows");
    const current = shadow.querySelector(".current");
    const progressBar = shadow.querySelector(".progress-bar");
    const progressFill = shadow.querySelector(".progress-fill");
    const progressCount = shadow.querySelector(".progress-count");
    const eta = shadow.querySelector(".eta");
    const startButton = shadow.querySelector(".start-button");
    const resumeButton = shadow.querySelector(".resume-button");
    const pauseButton = shadow.querySelector(".pause-button");
    const noticeBackdrop = shadow.querySelector(".notice-backdrop");
    const noticeMessage = shadow.querySelector(".notice-message");
    const noticeClose = shadow.querySelector(".notice-close");
    const noticeResume = shadow.querySelector(".notice-resume");
    let shownPauseNoticeKey = null;

    startInput.value = daysAgoIso(1);
    endInput.value = todayIso();

    function setError(message) {
      error.textContent = message || "";
      error.classList.toggle("hidden", !message);
    }

    function closePauseNotice() {
      noticeBackdrop.classList.add("hidden");
    }

    function showPauseNotice(summary) {
      const job = summary?.job;
      const noticeKey = `${job?.jobId || ""}:${job?.lastError || ""}`;
      if (!noticeKey || noticeKey === shownPauseNoticeKey || !isPageResponseError(job?.lastError)) {
        return;
      }
      shownPauseNoticeKey = noticeKey;
      noticeMessage.textContent = summary?.lastErrorMessage || "The download paused. Everything downloaded so far is saved on this computer.";
      noticeBackdrop.classList.remove("hidden");
    }

    function syncRangeInputs(summary) {
      const job = summary?.job;
      const display = summary?.display || {};
      if (!job?.startDate || !job?.endDate || !display.showActiveProgress) return;
      // Do not overwrite a date the user is actively editing, but after refresh
      // make the controls reflect the persisted job that Resume will use.
      if (shadow.activeElement === startInput || shadow.activeElement === endInput) return;
      startInput.value = job.startDate;
      endInput.value = job.endDate;
    }

    function render(summary) {
      const job = summary?.job;
      const display = summary?.display || {};
      const progress = summary?.progress || {};
      syncRangeInputs(summary);
      days.textContent = String(summary?.doneDays || 0);
      rows.textContent = String(summary?.rows || 0);
      current.textContent = display.showActiveProgress ? job?.currentDay || "-" : "-";
      progressFill.style.width = `${progress.percent || 0}%`;
      progressBar.setAttribute("aria-valuenow", String(progress.percent || 0));
      progressCount.textContent = `${progress.completedDays || 0} of ${progress.totalDays || 0} days`;
      eta.textContent = progress.etaText || "-";
      pauseButton.disabled = !display.isRunningNow;
      resumeButton.disabled = job?.status !== "paused";

      if (!summary?.pageReady) {
        status.textContent = "Open the energy usage page.";
      } else if (display.isRunningNow) {
        status.textContent = "Downloading. This panel can stay open.";
      } else if (display.isPausedNow || job?.status === "paused") {
        status.textContent = job?.lastError
          ? "Paused. Everything downloaded so far is saved."
          : "Paused.";
        showPauseNotice(summary);
      } else if (display.isCompleteNow) {
        status.textContent = "Download complete.";
      } else if (display.isInterrupted) {
        status.textContent = "Ready. Previous download was interrupted.";
      } else if (summary?.rows) {
        status.textContent = "Ready. Saved data is available.";
      } else {
        status.textContent = "Ready.";
      }
    }

    async function refresh() {
      render(await summarizeStoredData());
    }

    async function run(action) {
      try {
        setError("");
        await action();
        await refresh();
      } catch (caught) {
        setError(caught.message || String(caught));
      }
    }

    startButton.addEventListener("click", () => run(() => startDownload(startInput.value, endInput.value)));
    resumeButton.addEventListener("click", () => run(resumeDownload));
    pauseButton.addEventListener("click", () => run(pauseDownload));
    shadow.querySelector(".collapse").addEventListener("click", () => host.remove());
    noticeClose.addEventListener("click", closePauseNotice);
    noticeResume.addEventListener("click", () => run(async () => {
      closePauseNotice();
      await resumeDownload();
    }));

    refresh();
    window.setInterval(refresh, 2_500);
  }

  async function runDownload(startDate, endDate) {
    if (activeRun) {
      return;
    }

    const token = {};
    activeRun = token;
    const jobId = createJobId();
    sessionJobId = jobId;
    sessionCompletedJobId = null;
    const days = enumerateDays(startDate, endDate);

    try {
      await writeJob({
        jobId,
        status: "running",
        startDate,
        endDate,
        startedAt: new Date().toISOString(),
        currentDay: null,
        totalDays: days.length,
        completedDays: 0,
        lastError: null
      });

      for (const day of days) {
        if (activeRun !== token) return;

        const job = await readJob();
        if (!job || job.status !== "running") {
          return;
        }

        const done = await isDayDone(day);
        const completedDays = days.filter(candidate => candidate < day).length + (done ? 1 : 0);
        await writeJob({ ...job, currentDay: day, completedDays });

        if (!done) {
          try {
            await requestDay(day);
          } catch (error) {
            await writeJob({
              ...(await readJob()),
              status: "paused",
              lastError: error.message || String(error),
              lastErrorMessage: friendlyErrorMessage(error.message || String(error))
            });
            return;
          }
          // The page is fragile under rapid date changes; spacing requests out
          // makes long downloads more recoverable in normal browser use.
          await sleep(randomDelay());
        }
      }

      const summary = await summarizeStoredData();
      await writeJob({
        ...(await readJob()),
        status: "complete",
        currentDay: endDate,
        completedDays: summary.progress.completedDays,
        lastError: null
      });
      sessionCompletedJobId = jobId;
    } finally {
      if (activeRun === token) activeRun = null;
    }
  }

  async function startDownload(startDate, endDate) {
    if (startDate > endDate) {
      throw new Error("Start date must be before end date.");
    }
    runDownload(startDate, endDate);
    return summarizeStoredData();
  }

  async function pauseDownload() {
    activeRun = null;
    const job = await readJob();
    if (job) {
      await writeJob({ ...job, status: "paused" });
    }
    return summarizeStoredData();
  }

  async function resumeDownload() {
    const job = await readJob();
    if (!job?.startDate || !job?.endDate) {
      throw new Error("No previous download job found.");
    }
    // Resuming starts a fresh run over the same range. Days already saved are
    // skipped, so only missing/failed days are requested again.
    return startDownload(job.startDate, job.endDate);
  }

  async function clearStoredData() {
    const all = await storage.get(null);
    const keys = Object.keys(all).filter(key => key.startsWith(DAY_KEY_PREFIX)
      || key === STORAGE_JOB_KEY
      || key === STORAGE_META_KEY
      || key === PENDING_SHARE_KEY
      || key === SHARE_GRANTS_KEY);
    await storage.remove(keys);
    activeRun = null;
    return summarizeStoredData();
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source !== HOOK_SOURCE || data.type !== "captured-usage-intervals") return;
    if (Array.isArray(data.rows)) {
      handleCapturedUsage(data);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case "ENERGY_STATUS":
          return summarizeStoredData();
        case "ENERGY_START":
          return startDownload(message.startDate, message.endDate || todayIso());
        case "ENERGY_PAUSE":
          return pauseDownload();
        case "ENERGY_RESUME":
          return resumeDownload();
        case "ENERGY_EXPORT":
          return exportData(message.format || "csv");
        case "ENERGY_CLEAR":
          return clearStoredData();
        default:
          throw new Error(`Unknown message type: ${message?.type}`);
      }
    })()
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureInlinePanel, { once: true });
  } else {
    ensureInlinePanel();
  }
})();
