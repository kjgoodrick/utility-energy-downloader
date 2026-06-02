((root) => {
  "use strict";

  const PENDING_SHARE_KEY = "energy.share.pending";
  const SHARE_GRANTS_KEY = "energy.share.grants";
  const GRANT_TTL_MS = 15 * 60 * 1000;
  const ALLOWED_ORIGINS = new Set([
    "https://offpeakadvisor.com",
    "https://www.offpeakadvisor.com"
  ]);
  const exportApi = root.energyUsageExport || (typeof require === "function" ? require("./export.js") : null);
  if (!exportApi) {
    throw new Error("Load export.js before bridge.js.");
  }
  const {
    CSV_FORMAT,
    CSV_HEADERS,
    CSV_MIME,
    collectStoredRowsFromSnapshot,
    csvFile,
    csvFileName,
    csvValue,
    rowsToCsv,
    sanitizeRow
  } = exportApi;

  function originFromSender(sender) {
    if (sender?.origin) return sender.origin;
    if (sender?.url) {
      try {
        return new URL(sender.url).origin;
      } catch {
        return "";
      }
    }
    return "";
  }

  function originAllowed(origin) {
    return ALLOWED_ORIGINS.has(origin);
  }

  async function collectStoredRows(chromeApi) {
    const all = await chromeApi.storage.local.get(null);
    return collectStoredRowsFromSnapshot(all);
  }

  async function hasGrant(chromeApi, origin, now = Date.now()) {
    const values = await chromeApi.storage.local.get(SHARE_GRANTS_KEY);
    const grants = values[SHARE_GRANTS_KEY] || {};
    const grant = grants[origin];
    return Boolean(grant?.approvedAt && now - Date.parse(grant.approvedAt) <= GRANT_TTL_MS);
  }

  async function rememberPending(chromeApi, origin, rowCount) {
    await chromeApi.storage.local.set({
      [PENDING_SHARE_KEY]: {
        origin,
        requestedAt: new Date().toISOString(),
        rowCount
      }
    });
    return rowCount;
  }

  async function showPendingSharePrompt(chromeApi) {
    await Promise.resolve(chromeApi.action?.setBadgeText?.({ text: "TOU" })).catch(() => undefined);
    await Promise.resolve(chromeApi.action?.setBadgeBackgroundColor?.({ color: "#c9933a" })).catch(() => undefined);
    await Promise.resolve(chromeApi.action?.openPopup?.()).catch(() => undefined);
  }

  async function clearPendingSharePrompt(chromeApi) {
    await Promise.resolve(chromeApi.action?.setBadgeText?.({ text: "" })).catch(() => undefined);
  }

  async function approvePendingShare(chromeApi) {
    const values = await chromeApi.storage.local.get(PENDING_SHARE_KEY);
    const pending = values[PENDING_SHARE_KEY];
    if (!pending?.origin || !originAllowed(pending.origin)) {
      return { ok: false, status: "no_pending_request", message: "No analyzer request is waiting." };
    }

    const grantValues = await chromeApi.storage.local.get(SHARE_GRANTS_KEY);
    const grants = grantValues[SHARE_GRANTS_KEY] || {};
    grants[pending.origin] = {
      approvedAt: new Date().toISOString()
    };
    await chromeApi.storage.local.set({ [SHARE_GRANTS_KEY]: grants });
    await chromeApi.storage.local.remove(PENDING_SHARE_KEY);
    await clearPendingSharePrompt(chromeApi);
    return { ok: true, status: "approved", origin: pending.origin };
  }

  async function declinePendingShare(chromeApi) {
    await chromeApi.storage.local.remove(PENDING_SHARE_KEY);
    await clearPendingSharePrompt(chromeApi);
    return { ok: true, status: "declined" };
  }

  async function bridgeStatus(chromeApi) {
    const values = await chromeApi.storage.local.get([PENDING_SHARE_KEY, SHARE_GRANTS_KEY]);
    const rows = await collectStoredRows(chromeApi);
    let pending = values[PENDING_SHARE_KEY] || null;
    if (pending && !rows.length) {
      await chromeApi.storage.local.remove(PENDING_SHARE_KEY);
      await clearPendingSharePrompt(chromeApi);
      pending = null;
    } else if (pending) {
      pending = { ...pending, rowCount: rows.length };
    }
    return {
      ok: true,
      pending,
      grants: values[SHARE_GRANTS_KEY] || {},
      rowCount: rows.length,
      file: rows.length
        ? {
            name: csvFileName ? csvFileName(rows) : `energy-usage-${new Date().toISOString().slice(0, 10)}.csv`,
            mimeType: CSV_MIME,
            rowCount: rows.length
          }
        : null
    };
  }

  async function handleExternalMessage(chromeApi, message, sender) {
    if (message?.type !== "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER") {
      return { ok: false, status: "unknown_message", message: "Unknown external message." };
    }
    if (message.format !== CSV_FORMAT) {
      return { ok: false, status: "unsupported_format", message: "The TOU analyzer must request usage-csv-v2." };
    }

    const origin = originFromSender(sender);
    if (!originAllowed(origin)) {
      return { ok: false, status: "forbidden", message: "This website is not allowed to request usage data." };
    }

    const rows = await collectStoredRows(chromeApi);
    if (!rows.length) {
      return { ok: false, status: "empty", message: "No saved usage data is available." };
    }

    if (!(await hasGrant(chromeApi, origin))) {
      const existingPending = await chromeApi.storage.local.get(PENDING_SHARE_KEY);
      const alreadyPending = existingPending[PENDING_SHARE_KEY]?.origin === origin;
      const rowCount = await rememberPending(chromeApi, origin, rows.length);
      if (!alreadyPending) {
        await showPendingSharePrompt(chromeApi);
      }
      return {
        ok: false,
        status: "approval_required",
        rowCount,
        message: "Open the Utility Energy Downloader extension and approve sharing with the TOU analyzer."
      };
    }

    const exportedAt = new Date().toISOString();
    return {
      ok: true,
      status: "ok",
      format: CSV_FORMAT,
      exportedAt,
      file: csvFile(rows, exportedAt)
    };
  }

  async function handleRuntimeMessage(chromeApi, message) {
    switch (message?.type) {
      case "ENERGY_BRIDGE_STATUS":
        return bridgeStatus(chromeApi);
      case "ENERGY_BRIDGE_APPROVE":
        return approvePendingShare(chromeApi);
      case "ENERGY_BRIDGE_DECLINE":
        return declinePendingShare(chromeApi);
      default:
        return null;
    }
  }

  function install(chromeApi) {
    chromeApi.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      handleExternalMessage(chromeApi, message, sender)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, status: "error", message: error.message || String(error) }));
      return true;
    });

    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      handleRuntimeMessage(chromeApi, message)
        .then(response => {
          if (response) sendResponse(response);
        })
        .catch(error => sendResponse({ ok: false, status: "error", message: error.message || String(error) }));
      return true;
    });
  }

  const api = {
    ALLOWED_ORIGINS,
    CSV_FORMAT,
    CSV_HEADERS,
    CSV_MIME,
    PENDING_SHARE_KEY,
    SHARE_GRANTS_KEY,
    approvePendingShare,
    bridgeStatus,
    collectStoredRows,
    csvFile,
    csvFileName,
    csvValue,
    declinePendingShare,
    handleExternalMessage,
    handleRuntimeMessage,
    install,
    originAllowed,
    originFromSender,
    rowsToCsv,
    sanitizeRow
  };

  root.energyUsageBridge = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
