(() => {
  "use strict";

  const elements = {
    status: document.querySelector("#status"),
    error: document.querySelector("#error"),
    errorText: document.querySelector("#error-text"),
    errorDismiss: document.querySelector("#error-dismiss"),
    startDate: document.querySelector("#start-date"),
    endDate: document.querySelector("#end-date"),
    progressBar: document.querySelector(".progress-bar"),
    progressFill: document.querySelector("#progress-fill"),
    progressCount: document.querySelector("#progress-count"),
    eta: document.querySelector("#eta"),
    daysSaved: document.querySelector("#days-saved"),
    daysUnavailable: document.querySelector("#days-unavailable"),
    rowsSaved: document.querySelector("#rows-saved"),
    currentDay: document.querySelector("#current-day"),
    start: document.querySelector("#start"),
    resume: document.querySelector("#resume"),
    pause: document.querySelector("#pause"),
    stop: document.querySelector("#stop"),
    openUtility: document.querySelector("#open-utility"),
    exportCsv: document.querySelector("#export-csv"),
    clearData: document.querySelector("#clear-data"),
    bridge: document.querySelector("#bridge"),
    bridgeStatus: document.querySelector("#bridge-status"),
    approveShare: document.querySelector("#approve-share"),
    declineShare: document.querySelector("#decline-share")
  };
  let stickyError = false;

  function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function defaultStartDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setFullYear(date.getFullYear() - 2);
    return isoDate(date);
  }

  function defaultEndDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return isoDate(date);
  }

  function formatUserFacingIsoDay(day) {
    if (!day) return "-";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return day;
    return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
  }

  function applyDateLimits() {
    const maxDate = defaultEndDate();
    elements.startDate.max = maxDate;
    elements.endDate.max = maxDate;
    if (elements.startDate.value > maxDate) elements.startDate.value = maxDate;
    if (elements.endDate.value > maxDate) elements.endDate.value = maxDate;
  }

  function energyUsageUrl() {
    const manifest = chrome.runtime.getManifest();
    const match = manifest.content_scripts?.[0]?.matches?.[0] || "";
    return match.endsWith("*") ? match.slice(0, -1) : match;
  }

  function setError(message, options = {}) {
    stickyError = Boolean(message && options.sticky);
    elements.error.hidden = !message;
    elements.errorText.textContent = message || "";
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function sendToActiveTab(message) {
    const tab = await activeTab();
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (isMissingContentScriptError(error)) {
        throw new Error("The downloader is not active on this page. Reload the utility energy usage page, then try again.");
      }
      throw error;
    }
    if (!response?.ok) {
      throw new Error(response?.error || "The utility page is not ready.");
    }
    return response.result;
  }

  async function sendToBackground(message) {
    return chrome.runtime.sendMessage(message);
  }

  function isMissingContentScriptError(error) {
    const message = error?.message || String(error || "");
    return message.includes("Could not establish connection")
      || message.includes("Receiving end does not exist");
  }

  function renderStatus(summary) {
    const job = summary?.job;
    const display = summary?.display || {};
    const progress = summary?.progress || {};
    if (job?.startDate && job?.endDate && display.showActiveProgress && document.activeElement !== elements.startDate && document.activeElement !== elements.endDate) {
      // After a page refresh, Resume uses the persisted job range. Mirror that
      // range here so the popup never shows default dates for a resumable job.
      elements.startDate.value = job.startDate;
      elements.endDate.value = job.endDate;
    }
    elements.daysSaved.textContent = String(summary?.doneDays || 0);
    elements.daysUnavailable.textContent = String(summary?.unavailableDays || 0);
    elements.rowsSaved.textContent = String(summary?.rows || 0);
    elements.currentDay.textContent = display.showActiveProgress ? formatUserFacingIsoDay(job?.currentDay) : "-";
    elements.progressFill.style.width = `${progress.percent || 0}%`;
    elements.progressBar.setAttribute("aria-valuenow", String(progress.percent || 0));
    elements.progressCount.textContent = `${progress.completedDays || 0} of ${progress.totalDays || 0} days`;
    elements.eta.textContent = progress.etaText || "-";

    if (!summary?.pageReady) {
      elements.status.textContent = "Open the utility energy usage page and log in.";
    } else if (display.isRunningNow) {
      elements.status.textContent = "Downloading usage data. You can close this popup.";
    } else if (display.isPausedNow || job?.status === "paused") {
      elements.status.textContent = summary?.lastErrorMessage || "Paused.";
    } else if (display.isCompleteNow) {
      elements.status.textContent = summary?.unavailableDays
        ? `Download complete. Skipped ${summary.unavailableDays} unavailable day${summary.unavailableDays === 1 ? "" : "s"}.`
        : "Download complete.";
    } else if (display.isInterrupted) {
      elements.status.textContent = "Ready. Previous download was interrupted.";
    } else if (summary?.rows) {
      elements.status.textContent = "Ready. Saved data is available.";
    } else {
      elements.status.textContent = "Ready on the utility energy usage page.";
    }

    const canResume = job?.status === "paused" || display.isInterrupted;
    const canStop = display.isRunningNow || canResume;
    elements.start.hidden = display.isRunningNow || canResume;
    elements.resume.hidden = !canResume;
    elements.pause.hidden = !display.isRunningNow;
    elements.stop.hidden = !canStop;
    elements.resume.disabled = !canResume;
    elements.pause.disabled = !display.isRunningNow;
    elements.stop.disabled = !canStop;
    elements.exportCsv.disabled = !summary?.rows;
  }

  function renderBridgeStatus(status) {
    const pending = status?.pending;
    document.body.classList.toggle("approval-mode", Boolean(pending));
    elements.bridge.hidden = !pending;
    elements.approveShare.disabled = !pending;
    elements.declineShare.disabled = !pending;
    if (pending) {
      setError("");
      elements.status.textContent = "Approve sharing with Off Peak Advisor.";
      elements.bridgeStatus.textContent = `Share locally stored energy interval CSV with the Time-of-Use Rate Analyzer at https://offpeakadvisor.com. This request is from ${pending.origin} for ${pending.rowCount || 0} saved intervals.`;
    } else {
      elements.bridgeStatus.textContent = "No analyzer request is waiting.";
    }
  }

  function saveDownload(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function refresh() {
    try {
      if (!stickyError) setError("");
      const bridge = await sendToBackground({ type: "ENERGY_BRIDGE_STATUS" });
      if (bridge?.pending) {
        renderBridgeStatus(bridge);
        return;
      }
      const summary = await sendToActiveTab({ type: "ENERGY_STATUS" }).catch(error => {
        elements.status.textContent = "Open the utility energy usage page and log in.";
        renderStatus({ doneDays: 0, rows: 0, pageReady: false });
        if (isMissingContentScriptError(error)) {
          return null;
        }
        throw error;
      });
      if (summary) renderStatus(summary);
      renderBridgeStatus(bridge);
    } catch (error) {
      elements.status.textContent = "Open the utility energy usage page and log in.";
      if (!isMissingContentScriptError(error)) {
        setError(error.message);
      }
      renderStatus({ doneDays: 0, rows: 0, pageReady: false });
      sendToBackground({ type: "ENERGY_BRIDGE_STATUS" }).then(renderBridgeStatus).catch(() => {});
    }
  }

  async function run(action) {
    try {
      setError("");
      const summary = await action();
      if (summary) renderStatus(summary);
    } catch (error) {
      setError(error.message, { sticky: true });
    }
  }

  elements.errorDismiss.addEventListener("click", () => setError(""));
  elements.startDate.addEventListener("input", applyDateLimits);
  elements.startDate.addEventListener("change", applyDateLimits);
  elements.endDate.addEventListener("input", applyDateLimits);
  elements.endDate.addEventListener("change", applyDateLimits);

  elements.start.addEventListener("click", () => run(() => sendToActiveTab({
    type: "ENERGY_START",
    startDate: elements.startDate.value,
    endDate: elements.endDate.value
  })));

  elements.resume.addEventListener("click", () => run(() => sendToActiveTab({ type: "ENERGY_RESUME" })));
  elements.pause.addEventListener("click", () => run(() => sendToActiveTab({ type: "ENERGY_PAUSE" })));
  elements.stop.addEventListener("click", () => run(() => sendToActiveTab({ type: "ENERGY_STOP" })));

  elements.openUtility.addEventListener("click", async () => {
    await chrome.tabs.create({ url: energyUsageUrl() });
    window.close();
  });

  elements.exportCsv.addEventListener("click", () => run(async () => {
    const result = await sendToActiveTab({ type: "ENERGY_EXPORT", format: "csv" });
    saveDownload(result.filename || `energy-usage-timeseries-${isoDate(new Date())}.csv`, result.text, result.mime);
    return sendToActiveTab({ type: "ENERGY_STATUS" });
  }));

  elements.clearData.addEventListener("click", () => run(async () => {
    if (!confirm("Clear all locally saved usage data?")) {
      return null;
    }
    return sendToActiveTab({ type: "ENERGY_CLEAR" });
  }));

  elements.approveShare.addEventListener("click", () => run(async () => {
    await sendToBackground({ type: "ENERGY_BRIDGE_APPROVE" });
    renderBridgeStatus(await sendToBackground({ type: "ENERGY_BRIDGE_STATUS" }));
    window.close();
    return null;
  }));

  elements.declineShare.addEventListener("click", () => run(async () => {
    await sendToBackground({ type: "ENERGY_BRIDGE_DECLINE" });
    renderBridgeStatus(await sendToBackground({ type: "ENERGY_BRIDGE_STATUS" }));
    return null;
  }));

  applyDateLimits();
  elements.startDate.value = defaultStartDate();
  elements.endDate.value = defaultEndDate();
  applyDateLimits();
  refresh();
  setInterval(refresh, 2_500);
})();
