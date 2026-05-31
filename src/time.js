((root) => {
  "use strict";

  function parseIsoDay(day) {
    const parts = parseIsoDayParts(day);
    const date = parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : new Date(NaN);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`Invalid date: ${day}`);
    }
    return date;
  }

  function isoDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(day, count) {
    const date = parseIsoDay(day);
    date.setUTCDate(date.getUTCDate() + count);
    return isoDate(date);
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

  function parseIsoDayParts(day) {
    const match = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }

  function offsetMinutesForZone(readDateIso, parsedTime, occurrence = 1, timeZone = "America/Denver") {
    const parts = parseIsoDayParts(readDateIso);
    if (!parts) return null;

    const { year, month, day } = parts;
    const localMs = Date.UTC(year, month - 1, day, parsedTime.hour, parsedTime.minute || 0, parsedTime.second || 0);
    const matches = [];
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const utcMs = localMs - offset * 60_000;
      if (formatsAsZoneWallTime(utcMs, parts, parsedTime, timeZone)) {
        matches.push({ offset, utcMs });
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => a.utcMs - b.utcMs);
    return matches[Math.min(Math.max(Number(occurrence) || 1, 1), matches.length) - 1].offset;
  }

  function formatsAsZoneWallTime(utcMs, dateParts, timeParts, timeZone) {
    const formatted = dateTimePartsInZone(utcMs, timeZone);
    return formatted.year === dateParts.year
      && formatted.month === dateParts.month
      && formatted.day === dateParts.day
      && formatted.hour === timeParts.hour
      && formatted.minute === (timeParts.minute || 0)
      && formatted.second === (timeParts.second || 0);
  }

  function dateTimePartsInZone(utcMs, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const values = Object.fromEntries(formatter.formatToParts(new Date(utcMs))
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)]));
    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second
    };
  }

  function formatOffset(minutes) {
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  }

  function timestampLocal(readDateIso, readTime, occurrence = 1, timeZone = "America/Denver") {
    if (!readDateIso || !readTime) return null;
    const parsed = parseReadTime(readTime);
    if (!parsed) return null;

    let date = readDateIso;
    let time = parsed;
    if (parsed.hour === 24) {
      date = addDays(readDateIso, 1);
      time = { hour: 0, minute: 0, second: 0 };
    }
    const offset = offsetMinutesForZone(date, time, occurrence, timeZone);
    if (offset === null) return null;
    return [
      `${date}T${String(time.hour).padStart(2, "0")}`,
      String(time.minute).padStart(2, "0"),
      `${String(time.second).padStart(2, "0")}${formatOffset(offset)}`
    ].join(":");
  }

  const api = { offsetMinutesForZone, parseReadTime, timestampLocal };
  root.energyUsageTime = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
