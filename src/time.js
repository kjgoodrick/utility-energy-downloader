((root) => {
  "use strict";

  function parseIsoDay(day) {
    const date = new Date(`${day}T00:00:00`);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`Invalid date: ${day}`);
    }
    return date;
  }

  function parseReadTime(readTime) {
    const text = String(readTime || "").trim();
    const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(AM|PM)?$/i);
    if (!match) return null;

    let hour = Number(match[1]);
    const minute = Number(match[2] || "0");
    const second = Number(match[3] || "0");
    const meridiem = match[4]?.toUpperCase();
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;
    if (minute < 0 || minute > 59 || second < 0 || second > 59) return null;

    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      if (meridiem === "AM" && hour === 12) hour = 0;
      if (meridiem === "PM" && hour !== 12) hour += 12;
    }

    if (hour < 0 || hour > 24) return null;
    if (hour === 24 && (minute !== 0 || second !== 0)) return null;
    return { hour, minute, second };
  }

  function timestampLocal(readDateIso, readTime) {
    if (!readDateIso || !readTime) return null;
    const parsed = parseReadTime(readTime);
    if (!parsed) return null;

    // Preserve the utility's local clock time instead of inventing a timezone
    // offset. DST fall-back duplicates are disambiguated by row metadata in the
    // downloader, because a bare local timestamp cannot represent both hours.
    const date = parseIsoDay(readDateIso);
    if (parsed.hour === 24) {
      date.setDate(date.getDate() + 1);
      return `${date.toISOString().slice(0, 10)}T00:00:00`;
    }
    return [
      `${readDateIso}T${String(parsed.hour).padStart(2, "0")}`,
      String(parsed.minute).padStart(2, "0"),
      String(parsed.second).padStart(2, "0")
    ].join(":");
  }

  const api = { parseReadTime, timestampLocal };
  root.energyUsageTime = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
