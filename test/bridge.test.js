const assert = require("node:assert/strict");
const {
  CSV_FORMAT,
  PENDING_SHARE_KEY,
  SHARE_GRANTS_KEY,
  collectStoredRows,
  csvValue,
  handleExternalMessage,
  handleRuntimeMessage,
  originAllowed,
  rowsToCsv,
  sanitizeRow
} = require("../src/bridge.js");

function fakeChrome(seed = {}) {
  const state = { ...seed };
  return {
    state,
    storage: {
      local: {
        async get(keys) {
          if (keys === null) return { ...state };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(key => [key, state[key]]));
          }
          return { [keys]: state[keys] };
        },
        async set(values) {
          Object.assign(state, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete state[key];
          }
        }
      }
    }
  };
}

assert.equal(originAllowed("http://localhost:5173"), true);
assert.equal(originAllowed("https://offpeakadvisor.com"), true);
assert.equal(originAllowed("https://attacker.example"), false);
assert.equal(csvValue('with "quotes", comma\nnewline'), '"with ""quotes"", comma\nnewline"');

assert.deepEqual(
  sanitizeRow({
    timestamp_local: "2026-05-08T01:00:00",
    interval_index: 1,
    read_date: "2026-05-08",
    read_time: "01:00",
    read_time_occurrence: 1,
    usage_kwh: 1.25,
    billingAccountNumber: "must-not-cross"
  }),
  {
    timestamp_local: "2026-05-08T01:00:00",
    interval_index: 1,
    read_date: "2026-05-08",
    read_time: "01:00",
    read_time_occurrence: 1,
    usage_kwh: 1.25
  }
);

const chromeApi = fakeChrome({
  "energy.day.2026-05-08": {
    status: "done",
    day: "2026-05-08",
    rows: [
      {
        timestamp_local: "2026-05-08T01:00:00",
        interval_index: 1,
        read_date: "2026-05-08",
        read_time: "01:00",
        read_time_occurrence: 1,
        usage_kwh: 1.25,
        billingAccountNumber: "must-not-cross"
      }
    ]
  }
});

(async () => {
  const rows = await collectStoredRows(chromeApi);
  assert.equal(rows.length, 1);
  assert.equal("billingAccountNumber" in rows[0], false);

  const csv = rowsToCsv(rows);
  assert.equal(csv.split("\n")[0], "timestamp_local,interval_index,read_date,read_time,read_time_occurrence,usage_kwh");
  assert.equal(csv.split("\n")[1], "2026-05-08T01:00:00,1,2026-05-08,01:00,1,1.25");

  const forbidden = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER" },
    { origin: "http://localhost:5173" }
  );
  assert.equal(forbidden.status, "unsupported_format");

  const attacker = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://attacker.example" }
  );
  assert.equal(attacker.status, "forbidden");

  const pending = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "http://localhost:5173" }
  );
  assert.equal(pending.status, "approval_required");
  assert.equal(chromeApi.state[PENDING_SHARE_KEY].origin, "http://localhost:5173");

  const approved = await handleRuntimeMessage(chromeApi, { type: "ENERGY_BRIDGE_APPROVE" });
  assert.equal(approved.status, "approved");
  assert.equal(Boolean(chromeApi.state[SHARE_GRANTS_KEY]["http://localhost:5173"]), true);

  const shared = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "http://localhost:5173" }
  );
  assert.equal(shared.ok, true);
  assert.equal(shared.format, CSV_FORMAT);
  assert.equal(shared.file.kind, "csv");
  assert.equal(shared.file.rowCount, 1);
  assert.equal(shared.file.text.includes("billingAccountNumber"), false);
  assert.equal(shared.file.text.split("\n")[1], "2026-05-08T01:00:00,1,2026-05-08,01:00,1,1.25");

  console.log("bridge privacy checks passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
