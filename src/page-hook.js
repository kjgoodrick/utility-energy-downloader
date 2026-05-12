((root) => {
  "use strict";

  const SOURCE = "energy-usage-downloader";
  const INTERVAL_USAGE_ENDPOINT = "/api/energy-usage/getIntervalUsageForDate";
  const nativeJsonParse = JSON.parse;

  function endpointMatchesUsage(url) {
    return String(url || "").includes(INTERVAL_USAGE_ENDPOINT);
  }

  function sanitizeUsageRows(value) {
    const intervalRows = value
      ?.getIntervalUsageForDateResponseBody
      ?.response
      ?.intervalDataResponse;
    if (!Array.isArray(intervalRows)) return null;

    const rows = intervalRows
      .map(item => ({
        readDate: item?.readDate ?? null,
        readTime: item?.readTime ?? null,
        usage: item?.usage ?? null
      }))
      .filter(row => row.readDate !== null && row.readTime !== null);

    return rows.length > 0 ? rows : null;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { sanitizeUsageRows };
  }

  const pageWindow = root.window;
  if (!pageWindow?.postMessage) {
    return;
  }

  // This file runs in the page's MAIN world so it can observe the page's own
  // fetch/XHR/JSON.parse calls. The isolated content script listens for these
  // messages and owns storage/UI; this hook only forwards minimal usage fields.
  if (pageWindow.__energyUsageDownloaderHooked) {
    return;
  }
  pageWindow.__energyUsageDownloaderHooked = true;

  function parseJsonText(text) {
    try {
      return nativeJsonParse(String(text || ""));
    } catch {
      return null;
    }
  }

  function postUsageIntervals(value, status) {
    const rows = sanitizeUsageRows(value);
    if (!rows) return;

    pageWindow.postMessage(
      {
        source: SOURCE,
        type: "captured-usage-intervals",
        capturedAt: new Date().toISOString(),
        status,
        rows
      },
      pageWindow.location.origin
    );
  }

  async function readFetchResponse(response) {
    try {
      const clone = response.clone();
      const text = await clone.text();
      postUsageIntervals(parseJsonText(text), response.status);
    } catch {
      // Ignore unreadable responses; only sanitized usage rows are bridged.
    }
  }

  const nativeFetch = pageWindow.fetch;
  if (typeof nativeFetch === "function") {
    pageWindow.fetch = async function energyUsageFetch(input, init) {
      const url = typeof input === "string" ? input : input?.url;
      const response = await nativeFetch.apply(this, arguments);
      if (endpointMatchesUsage(url || response.url)) {
        readFetchResponse(response);
      }
      return response;
    };
  }

  const nativeOpen = pageWindow.XMLHttpRequest.prototype.open;
  const nativeSend = pageWindow.XMLHttpRequest.prototype.send;

  pageWindow.XMLHttpRequest.prototype.open = function energyUsageOpen(method, url) {
    this.__energyUsageRequest = {
      isUsageEndpoint: endpointMatchesUsage(url)
    };
    return nativeOpen.apply(this, arguments);
  };

  pageWindow.XMLHttpRequest.prototype.send = function energyUsageSend() {
    if (this.__energyUsageRequest?.isUsageEndpoint) {
      this.addEventListener("loadend", () => {
        try {
          let value = null;
          if (!this.responseType || this.responseType === "text" || this.responseType === "json") {
            value = this.responseType === "json" ? this.response : parseJsonText(this.responseText);
          }
          postUsageIntervals(value, this.status);
        } catch {
          // Ignore unreadable responses; only sanitized usage rows are bridged.
        }
      });
    }
    return nativeSend.apply(this, arguments);
  };

  JSON.parse = function energyUsageJsonParse(text, reviver) {
    const value = nativeJsonParse.apply(this, arguments);
    // Some app frameworks parse JSON before a response body is easy to read.
    // Treat parsed target payloads as another capture path after sanitization.
    postUsageIntervals(value, 200);
    return value;
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
