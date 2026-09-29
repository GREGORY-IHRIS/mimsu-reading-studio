import { DEFAULT_DAILY_CALL_LIMIT, QUOTA_TIMEZONE } from "./config.js";

// Everything about "how many Gemini calls do we have left today" that can be
// computed without touching storage: which calendar day a call belongs to,
// when the counter resets, how usage events add up, and whether a planned job
// fits. Gemini exposes no "remaining quota" endpoint, so the app keeps its own
// ledger of calls (see lib/server/usageLog.js) and this file interprets it.

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: QUOTA_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

// "2026-09-29" – the Pacific-time date, which is the day Google's counter uses.
export function quotaDay(date = new Date()) {
  return dayFormatter.format(date);
}

// The next Pacific midnight. Offsets are whole hours, so stepping hour by hour
// from the current hour lands exactly on the reset instant (DST included).
export function nextQuotaReset(now = new Date()) {
  const hour = 3_600_000;
  const today = quotaDay(now);
  let t = Math.floor(now.getTime() / hour) * hour;
  do t += hour; while (quotaDay(new Date(t)) === today);
  return new Date(t);
}

// Calls Google most likely bills against the daily limit: everything that got
// a normal answer or a server-side failure. Rate-limit and quota refusals,
// rejected requests (HTTP 4xx) and requests that never arrived are not counted.
const COUNTED_OUTCOMES = new Set(["ok", "error", "timeout"]);

export function countsTowardLimit(event) {
  return event.bucket === "tts" && COUNTED_OUTCOMES.has(event.outcome);
}

// Reduces one day's events (oldest first) to the numbers the UI shows.
//   - an "adjust" event replaces the running count (manual correction)
//   - a daily-quota refusal from Gemini marks the day as exhausted, whatever
//     our own count says, because Google's answer is authoritative
export function summarizeDay(events, limit = DEFAULT_DAILY_CALL_LIMIT) {
  let used = 0;
  let exhaustedAt = null;
  const outcomes = {};
  const purposes = {};
  const buckets = {};

  for (const event of events) {
    if (event.type === "adjust") {
      used = event.used;
      exhaustedAt = null;
      continue;
    }
    outcomes[event.outcome] = (outcomes[event.outcome] || 0) + 1;
    buckets[event.bucket] = (buckets[event.bucket] || 0) + 1;
    purposes[event.purpose] = (purposes[event.purpose] || 0) + 1;
    if (countsTowardLimit(event)) used += 1;
    if (event.bucket === "tts" && event.outcome === "quota_exhausted") exhaustedAt = event.ts;
  }

  return {
    used,
    limit,
    remaining: exhaustedAt ? 0 : Math.max(0, limit - used),
    exhaustedAt,
    outcomes,
    purposes,
    buckets,
    total: events.filter((event) => event.type !== "adjust").length,
  };
}

// Decides what to tell the user before a job starts.
//   ok        – plenty left, nothing to say
//   tight     – fits, but leaves few calls for the rest of the day
//   over      – needs more calls than are left (a confirm is required)
//   exhausted – nothing left today (a confirm is required)
//   unknown   – usage could not be loaded; never blocks the job
export function assessBudget({ needed, usage }) {
  if (needed <= 0) return { level: "ok", needed, remaining: usage?.remaining ?? null, needsConfirm: false };
  if (!usage) return { level: "unknown", needed, remaining: null, needsConfirm: false };

  const { remaining } = usage;
  let level = "ok";
  if (remaining <= 0) level = "exhausted";
  else if (needed > remaining) level = "over";
  else if (remaining - needed < Math.ceil(usage.limit * 0.1)) level = "tight";
  return { level, needed, remaining, needsConfirm: level === "over" || level === "exhausted" };
}
