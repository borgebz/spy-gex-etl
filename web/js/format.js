/* Number and time formatting. Classic script (no modules) so the page works from file://. */
window.GA = window.GA || {};

GA.fmt = (function () {
  const MINUS = "−";
  const etTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const etDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
  });
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23",
  });

  const signed = (text, v) => (v < 0 ? MINUS + text : v > 0 ? "+" + text : text);

  return {
    MINUS,
    /** USD per 1% move → "−14.33B" */
    gex(v, digits = 2) {
      const a = Math.abs(v);
      const text = a >= 1e9 ? (a / 1e9).toFixed(digits) + "B" : (a / 1e6).toFixed(0) + "M";
      return signed(text, v);
    },
    /** Unsigned billions for axes and tooltips → "1.4" */
    bn(v, digits = 1) {
      return (v < 0 ? MINUS : "") + Math.abs(v / 1e9).toFixed(digits);
    },
    price(v) { return Number(v).toFixed(2); },
    strike(v) { return Number.isInteger(+v) ? String(+v) : (+v).toFixed(1); },
    int(v) { return Number(v).toLocaleString("en-US"); },
    /** ISO UTC → "Oct 22, 15:59 ET" */
    asOf(iso) { const d = new Date(iso); return `${etDay.format(d)}, ${etTime.format(d)} ET`; },
    /** "2026-10-23" → "Oct 23" (a calendar date, no time zone shift) */
    day(ymd) {
      return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    },
    /** ms or ISO → "15:59" */
    hhmm(t) { return etTime.format(new Date(t)); },
    /** Minutes since midnight in New York, for the regular-session filter */
    etMinutes(iso) {
      const p = etParts.formatToParts(new Date(iso));
      const get = (k) => +p.find((x) => x.type === k).value;
      return get("hour") * 60 + get("minute");
    },
  };
})();
