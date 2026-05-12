((root) => {
  "use strict";

  const DAY_KEY_PREFIX = "energy.day.";
  const PENDING_SHARE_KEY = "energy.share.pending";
  const SHARE_GRANTS_KEY = "energy.share.grants";
  const CSV_FORMAT = "usage-csv-v1";
  const CSV_MIME = "text/csv";
  const CSV_HEADERS = ["timestamp_local", "interval_index", "read_date", "read_time", "read_time_occurrence", "usage_kwh"];
  const GRANT_TTL_MS = 15 * 60 * 1000;
  const ALLOWED_ORIGINS = new Set([
    "http://localhost",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
    "https://offpeakadvisor.com"
  ]);

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

  function sanitizeRow(row) {
    return {
      timestamp_local: row?.timestamp_local ?? null,
      interval_index: row?.interval_index ?? null,
      read_date: row?.read_date_iso ?? row?.read_date ?? null,
      read_time: row?.read_time ?? null,
      read_time_occurrence: row?.read_time_occurrence ?? null,
      usage_kwh: row?.usage_kwh ?? null
    };
  }

  async function collectStoredRows(chromeApi) {
    const all = await chromeApi.storage.local.get(null);
    const dayRecords = Object.entries(all)
      .filter(([key, value]) => key.startsWith(DAY_KEY_PREFIX) && value?.status === "done")
      .map(([, value]) => value)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));

    return dayRecords
      .flatMap(record => record.rows || [])
      .map(sanitizeRow)
      .filter(row => row.timestamp_local && row.usage_kwh !== null)
      .sort((a, b) => String(a.timestamp_local).localeCompare(String(b.timestamp_local)));
  }

  function csvValue(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function rowsToCsv(rows) {
    return [
      CSV_HEADERS.join(","),
      ...rows.map(row => CSV_HEADERS.map(header => csvValue(row[header])).join(","))
    ].join("\n");
  }

  function csvFile(rows, exportedAt = new Date().toISOString()) {
    return {
      name: `energy-usage-timeseries-${exportedAt.slice(0, 10)}.csv`,
      kind: "csv",
      mimeType: CSV_MIME,
      text: rowsToCsv(rows),
      rowCount: rows.length
    };
  }

  async function hasGrant(chromeApi, origin, now = Date.now()) {
    const values = await chromeApi.storage.local.get(SHARE_GRANTS_KEY);
    const grants = values[SHARE_GRANTS_KEY] || {};
    const grant = grants[origin];
    return Boolean(grant?.approvedAt && now - Date.parse(grant.approvedAt) <= GRANT_TTL_MS);
  }

  async function rememberPending(chromeApi, origin) {
    const rows = await collectStoredRows(chromeApi);
    await chromeApi.storage.local.set({
      [PENDING_SHARE_KEY]: {
        origin,
        requestedAt: new Date().toISOString(),
        rowCount: rows.length
      }
    });
    return rows.length;
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
    return { ok: true, status: "approved", origin: pending.origin };
  }

  async function declinePendingShare(chromeApi) {
    await chromeApi.storage.local.remove(PENDING_SHARE_KEY);
    return { ok: true, status: "declined" };
  }

  async function bridgeStatus(chromeApi) {
    const values = await chromeApi.storage.local.get([PENDING_SHARE_KEY, SHARE_GRANTS_KEY]);
    const rows = await collectStoredRows(chromeApi);
    return {
      ok: true,
      pending: values[PENDING_SHARE_KEY] || null,
      grants: values[SHARE_GRANTS_KEY] || {},
      rowCount: rows.length,
      file: rows.length
        ? {
            name: `energy-usage-timeseries-${new Date().toISOString().slice(0, 10)}.csv`,
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
      return { ok: false, status: "unsupported_format", message: "The TOU analyzer must request usage-csv-v1." };
    }

    const origin = originFromSender(sender);
    if (!originAllowed(origin)) {
      return { ok: false, status: "forbidden", message: "This website is not allowed to request usage data." };
    }

    if (!(await hasGrant(chromeApi, origin))) {
      const rowCount = await rememberPending(chromeApi, origin);
      return {
        ok: false,
        status: "approval_required",
        rowCount,
        message: "Open the Utility Energy Downloader extension and approve sharing with the TOU analyzer."
      };
    }

    const rows = await collectStoredRows(chromeApi);
    if (!rows.length) {
      return { ok: false, status: "empty", message: "No saved usage data is available." };
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
