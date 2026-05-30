((root) => {
  "use strict";

  const DAY_KEY_PREFIX = "energy.day.";
  const CSV_FORMAT = "usage-csv-v1";
  const CSV_MIME = "text/csv";
  const CSV_HEADERS = ["timestamp_local", "interval_index", "read_date", "read_time", "read_time_occurrence", "usage_kwh"];

  function dayRecordsFromSnapshot(snapshot) {
    return Object.entries(snapshot || {})
      .filter(([key, value]) => key.startsWith(DAY_KEY_PREFIX) && value?.status === "done")
      .map(([, value]) => value)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
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

  function csvFile(rows, exportedAt = new Date().toISOString()) {
    return {
      name: `energy-usage-timeseries-${exportedAt.slice(0, 10)}.csv`,
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
