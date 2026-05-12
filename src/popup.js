(() => {
  "use strict";

  const elements = {
    status: document.querySelector("#status"),
    error: document.querySelector("#error"),
    startDate: document.querySelector("#start-date"),
    endDate: document.querySelector("#end-date"),
    progressBar: document.querySelector(".progress-bar"),
    progressFill: document.querySelector("#progress-fill"),
    progressCount: document.querySelector("#progress-count"),
    eta: document.querySelector("#eta"),
    daysSaved: document.querySelector("#days-saved"),
    rowsSaved: document.querySelector("#rows-saved"),
    currentDay: document.querySelector("#current-day"),
    start: document.querySelector("#start"),
    resume: document.querySelector("#resume"),
    pause: document.querySelector("#pause"),
    openUtility: document.querySelector("#open-utility"),
    exportCsv: document.querySelector("#export-csv"),
    clearData: document.querySelector("#clear-data"),
    bridgeStatus: document.querySelector("#bridge-status"),
    approveShare: document.querySelector("#approve-share"),
    declineShare: document.querySelector("#decline-share")
  };

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function defaultStartDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    return isoDate(date);
  }

  function energyUsageUrl() {
    const manifest = chrome.runtime.getManifest();
    const match = manifest.content_scripts?.[0]?.matches?.[0] || "";
    return match.endsWith("*") ? match.slice(0, -1) : match;
  }

  function setError(message) {
    elements.error.hidden = !message;
    elements.error.textContent = message || "";
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
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) {
      throw new Error(response?.error || "The utility page is not ready.");
    }
    return response.result;
  }

  async function sendToBackground(message) {
    return chrome.runtime.sendMessage(message);
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
    elements.rowsSaved.textContent = String(summary?.rows || 0);
    elements.currentDay.textContent = display.showActiveProgress ? job?.currentDay || "-" : "-";
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
      elements.status.textContent = "Download complete.";
    } else if (display.isInterrupted) {
      elements.status.textContent = "Ready. Previous download was interrupted.";
    } else if (summary?.rows) {
      elements.status.textContent = "Ready. Saved data is available.";
    } else {
      elements.status.textContent = "Ready on the utility energy usage page.";
    }

    elements.resume.disabled = job?.status !== "paused";
    elements.pause.disabled = !display.isRunningNow;
    elements.exportCsv.disabled = !summary?.rows;
  }

  function renderBridgeStatus(status) {
    const pending = status?.pending;
    elements.approveShare.disabled = !pending;
    elements.declineShare.disabled = !pending;
    if (pending) {
      elements.bridgeStatus.textContent = `${pending.origin} is requesting ${pending.rowCount || 0} saved intervals. Approve only if this is the TOU analyzer site you opened.`;
    } else if (status?.rowCount && status?.file) {
      elements.bridgeStatus.textContent = `${status.rowCount} saved intervals are available as ${status.file.name}. No analyzer request is waiting.`;
    } else {
      elements.bridgeStatus.textContent = "No saved usage data is available to share.";
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
      setError("");
      const [summary, bridge] = await Promise.all([
        sendToActiveTab({ type: "ENERGY_STATUS" }).catch(error => {
          elements.status.textContent = "Open the utility energy usage page and log in.";
          renderStatus({ doneDays: 0, rows: 0, pageReady: false });
          throw error;
        }),
        sendToBackground({ type: "ENERGY_BRIDGE_STATUS" })
      ]);
      renderStatus(summary);
      renderBridgeStatus(bridge);
    } catch (error) {
      elements.status.textContent = "Open the utility energy usage page and log in.";
      setError(error.message);
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
      setError(error.message);
    }
  }

  elements.start.addEventListener("click", () => run(() => sendToActiveTab({
    type: "ENERGY_START",
    startDate: elements.startDate.value,
    endDate: elements.endDate.value
  })));

  elements.resume.addEventListener("click", () => run(() => sendToActiveTab({ type: "ENERGY_RESUME" })));
  elements.pause.addEventListener("click", () => run(() => sendToActiveTab({ type: "ENERGY_PAUSE" })));

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
    return null;
  }));

  elements.declineShare.addEventListener("click", () => run(async () => {
    await sendToBackground({ type: "ENERGY_BRIDGE_DECLINE" });
    renderBridgeStatus(await sendToBackground({ type: "ENERGY_BRIDGE_STATUS" }));
    return null;
  }));

  elements.startDate.value = defaultStartDate();
  elements.endDate.value = isoDate(new Date());
  refresh();
  setInterval(refresh, 2_500);
})();
