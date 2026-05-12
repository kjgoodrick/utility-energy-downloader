const assert = require("node:assert/strict");
const { parseReadTime, timestampLocal } = require("../src/time.js");

assert.deepEqual(parseReadTime("13:15"), { hour: 13, minute: 15, second: 0 });
assert.deepEqual(parseReadTime("13:05:30"), { hour: 13, minute: 5, second: 30 });
assert.deepEqual(parseReadTime("1:05 PM"), { hour: 13, minute: 5, second: 0 });
assert.deepEqual(parseReadTime("12:00 AM"), { hour: 0, minute: 0, second: 0 });
assert.deepEqual(parseReadTime("12:00 PM"), { hour: 12, minute: 0, second: 0 });
assert.deepEqual(parseReadTime("24:00"), { hour: 24, minute: 0, second: 0 });
assert.equal(parseReadTime("24:15"), null);
assert.equal(parseReadTime("13:60"), null);
assert.equal(parseReadTime("not a time"), null);

assert.equal(timestampLocal("2026-05-08", "00:05"), "2026-05-08T00:05:00");
assert.equal(timestampLocal("2026-05-08", "13:15"), "2026-05-08T13:15:00");
assert.equal(timestampLocal("2026-05-08", "13:15:30"), "2026-05-08T13:15:30");
assert.equal(timestampLocal("2026-05-08", "1:15 PM"), "2026-05-08T13:15:00");
assert.equal(timestampLocal("2026-05-08", "24:00"), "2026-05-09T00:00:00");

console.log("time parser checks passed");
