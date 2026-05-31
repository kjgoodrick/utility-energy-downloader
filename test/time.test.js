const assert = require("node:assert/strict");
const { offsetMinutesForZone, parseReadTime, timestampLocal } = require("../src/time.js");

assert.deepEqual(parseReadTime("13:15"), { hour: 13, minute: 15, second: 0 });
assert.deepEqual(parseReadTime("13:05:30"), { hour: 13, minute: 5, second: 30 });
assert.deepEqual(parseReadTime("1:05 PM"), { hour: 13, minute: 5, second: 0 });
assert.deepEqual(parseReadTime("12:00 AM"), { hour: 0, minute: 0, second: 0 });
assert.deepEqual(parseReadTime("12:00 PM"), { hour: 12, minute: 0, second: 0 });
assert.deepEqual(parseReadTime("24:00"), { hour: 24, minute: 0, second: 0 });
assert.equal(parseReadTime("24:15"), null);
assert.equal(parseReadTime("13:60"), null);
assert.equal(parseReadTime("not a time"), null);

assert.equal(timestampLocal("2026-01-08", "00:05"), "2026-01-08T00:05:00-07:00");
assert.equal(timestampLocal("2026-05-08", "13:15"), "2026-05-08T13:15:00-06:00");
assert.equal(timestampLocal("2026-05-08", "13:15:30"), "2026-05-08T13:15:30-06:00");
assert.equal(timestampLocal("2026-05-08", "1:15 PM"), "2026-05-08T13:15:00-06:00");
assert.equal(timestampLocal("2026-05-08", "24:00"), "2026-05-09T00:00:00-06:00");
assert.equal(timestampLocal("2026-11-01", "01:00", 1), "2026-11-01T01:00:00-06:00");
assert.equal(timestampLocal("2026-11-01", "01:00", 2), "2026-11-01T01:00:00-07:00");
assert.equal(timestampLocal("2026-07-08", "13:15", 1, "America/Los_Angeles"), "2026-07-08T13:15:00-07:00");
assert.equal(timestampLocal("2026-11-01", "01:00", 1, "America/Los_Angeles"), "2026-11-01T01:00:00-07:00");
assert.equal(timestampLocal("2026-11-01", "01:00", 2, "America/Los_Angeles"), "2026-11-01T01:00:00-08:00");
assert.equal(offsetMinutesForZone("2026-03-08", { hour: 1 }), -420);
assert.equal(offsetMinutesForZone("2026-03-08", { hour: 2 }), null);
assert.equal(offsetMinutesForZone("2026-03-08", { hour: 3 }), -360);

console.log("time parser checks passed");
