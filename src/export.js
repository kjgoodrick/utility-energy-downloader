((root) => {
  "use strict";

  const DAY_KEY_PREFIX = "energy.day.";
  const CSV_FORMAT = "usage-csv-v2";
  const CSV_MIME = "text/csv";
  const CSV_HEADERS = ["timestamp_local", "usage_kwh"];
  const timeApi = root.energyUsageTime || (typeof require === "function" ? require("./time.js") : null);
  const DEFAULT_UTILITY_TIME_ZONE = "America/Denver";

  function dayRecordsFromSnapshot(snapshot) {
    return Object.entries(snapshot || {})
      .filter(([key, value]) => key.startsWith(DAY_KEY_PREFIX) && value?.status === "done")
      .map(([, value]) => value)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }

  function sanitizeRow(row) {
    const readDate = row?.read_date_iso ?? row?.read_date ?? null;
    const timestamp = readDate && row?.read_time && timeApi?.timestampLocal
      ? timeApi.timestampLocal(
          readDate,
          row.read_time,
          row?.read_time_occurrence,
          row?.utility_time_zone || DEFAULT_UTILITY_TIME_ZONE
        ) || row?.timestamp_local
      : row?.timestamp_local;
    return {
      timestamp_local: timestamp ?? null,
      usage_kwh: row?.usage_kwh ?? null
    };
  }

  function collectStoredRowsFromSnapshot(snapshot) {
    return dayRecordsFromSnapshot(snapshot)
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

  function csvFileName(rows, exportedAt = new Date().toISOString()) {
    const dates = rows
      .map(row => String(row.timestamp_local || "").slice(0, 10))
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    const first = dates[0];
    const last = dates.at(-1);
    if (first && last) {
      return `energy-usage-${first}-to-${last}.csv`;
    }
    return `energy-usage-${exportedAt.slice(0, 10)}.csv`;
  }

  function csvFile(rows, exportedAt = new Date().toISOString()) {
    return {
      name: csvFileName(rows, exportedAt),
      kind: "csv",
      mimeType: CSV_MIME,
      text: rowsToCsv(rows),
      rowCount: rows.length
    };
  }

  const api = {
    CSV_FORMAT,
    CSV_HEADERS,
    CSV_MIME,
    DAY_KEY_PREFIX,
    collectStoredRowsFromSnapshot,
    csvFile,
    csvFileName,
    csvValue,
    dayRecordsFromSnapshot,
    rowsToCsv,
    sanitizeRow
  };

  root.energyUsageExport = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
