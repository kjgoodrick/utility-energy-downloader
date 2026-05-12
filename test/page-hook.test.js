const assert = require("node:assert/strict");
const { sanitizeUsageRows } = require("../src/page-hook.js");

const usagePayload = {
  getIntervalUsageForDateResponseBody: {
    response: {
      intervalDataResponse: [
        {
          readDate: "05/08/2026",
          readTime: "1:00 AM",
          usage: "1.25",
          billingAccountNumber: "should-not-cross-bridge"
        },
        {
          readDate: "05/08/2026",
          readTime: "2:00 AM",
          usage: 0.75,
          extra: { nested: true }
        }
      ]
    }
  }
};

assert.deepEqual(sanitizeUsageRows(usagePayload), [
  { readDate: "05/08/2026", readTime: "1:00 AM", usage: "1.25" },
  { readDate: "05/08/2026", readTime: "2:00 AM", usage: 0.75 }
]);

assert.equal(
  sanitizeUsageRows({
    getHourlyTemperatureForBsnsUnitResponseBody: {
      response: { hourlyTemperatureResponse: [{ temperature: 72 }] }
    }
  }),
  null
);

assert.equal(sanitizeUsageRows({ unrelated: true }), null);
assert.equal(
  sanitizeUsageRows({
    getIntervalUsageForDateResponseBody: {
      response: { intervalDataResponse: "not rows" }
    }
  }),
  null
);
assert.equal(
  sanitizeUsageRows({
    getIntervalUsageForDateResponseBody: {
      response: { intervalDataResponse: [{ readDate: "05/08/2026" }] }
    }
  }),
  null
);

console.log("page hook sanitizer checks passed");
