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

assert.equal(originAllowed("http://localhost:5173"), false);
assert.equal(originAllowed("https://offpeakadvisor.com"), true);
assert.equal(originAllowed("https://www.offpeakadvisor.com"), true);
assert.equal(originAllowed("https://attacker.example"), false);
assert.equal(csvValue('with "quotes", comma\nnewline'), '"with ""quotes"", comma\nnewline"');

assert.deepEqual(
  sanitizeRow({
    timestamp_local: "2026-05-08T01:00:00-06:00",
    interval_index: 1,
    read_date: "2026-05-08",
    read_time: "01:00",
    read_time_occurrence: 1,
    usage_kwh: 1.25,
    billingAccountNumber: "must-not-cross"
  }),
  {
    timestamp_local: "2026-05-08T01:00:00-06:00",
    usage_kwh: 1.25
  }
);

const chromeApi = fakeChrome({
  "energy.day.2026-05-08": {
    status: "done",
    day: "2026-05-08",
    rows: [
      {
        timestamp_local: "2026-05-08T01:00:00-06:00",
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
  assert.equal(csv.split("\n")[0], "timestamp_local,usage_kwh");
  assert.equal(csv.split("\n")[1], "2026-05-08T01:00:00-06:00,1.25");

  const forbidden = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "http://localhost:5173" }
  );
  assert.equal(forbidden.status, "forbidden");

  const attacker = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://attacker.example" }
  );
  assert.equal(attacker.status, "forbidden");

  const emptyChromeApi = fakeChrome();
  const empty = await handleExternalMessage(
    emptyChromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://www.offpeakadvisor.com" }
  );
  assert.equal(empty.status, "empty");
  assert.equal(emptyChromeApi.state[PENDING_SHARE_KEY], undefined);

  const stalePendingChromeApi = fakeChrome({
    [PENDING_SHARE_KEY]: {
      origin: "https://offpeakadvisor.com",
      requestedAt: new Date().toISOString(),
      rowCount: 0
    }
  });
  const stalePendingStatus = await handleRuntimeMessage(stalePendingChromeApi, { type: "ENERGY_BRIDGE_STATUS" });
  assert.equal(stalePendingStatus.pending, null);
  assert.equal(stalePendingChromeApi.state[PENDING_SHARE_KEY], undefined);

  const pending = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://offpeakadvisor.com" }
  );
  assert.equal(pending.status, "approval_required");
  assert.equal(chromeApi.state[PENDING_SHARE_KEY].origin, "https://offpeakadvisor.com");

  const approved = await handleRuntimeMessage(chromeApi, { type: "ENERGY_BRIDGE_APPROVE" });
  assert.equal(approved.status, "approved");
  assert.equal(Boolean(chromeApi.state[SHARE_GRANTS_KEY]["https://offpeakadvisor.com"]), true);

  const shared = await handleExternalMessage(
    chromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://offpeakadvisor.com" }
  );
  assert.equal(shared.ok, true);
  assert.equal(shared.format, CSV_FORMAT);
  assert.equal(shared.file.kind, "csv");
  assert.equal(shared.file.rowCount, 1);
  assert.equal(shared.file.text.includes("billingAccountNumber"), false);
  assert.equal(shared.file.text.split("\n")[1], "2026-05-08T01:00:00-06:00,1.25");

  const wwwChromeApi = fakeChrome({
    "energy.day.2026-05-08": {
      status: "done",
      day: "2026-05-08",
      rows: [
        {
          timestamp_local: "2026-05-08T01:00:00-06:00",
          usage_kwh: 1.25
        }
      ]
    }
  });
  const wwwPending = await handleExternalMessage(
    wwwChromeApi,
    { type: "ENERGY_USAGE_EXPORT_FOR_TOU_ANALYZER", format: CSV_FORMAT },
    { origin: "https://www.offpeakadvisor.com" }
  );
  assert.equal(wwwPending.status, "approval_required");
  assert.equal(wwwChromeApi.state[PENDING_SHARE_KEY].origin, "https://www.offpeakadvisor.com");

  console.log("bridge privacy checks passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
