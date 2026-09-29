import crypto from "crypto";
import { DEFAULT_DAILY_CALL_LIMIT } from "../shared/config.js";
import { nextQuotaReset, quotaDay, summarizeDay } from "../shared/quota.js";
import { readJsonFresh, usingBlob, writeJson } from "./storage.js";

// The usage ledger: one entry for every request this app sends to Gemini (see
// lib/server/gemini.js), grouped in one JSON file per Pacific-time day — the
// same day boundary Google's daily counter uses.
//
//   local : .data/usage/2026-09-29.json
//   Blob  : usage/<secret>/2026-09-29.json   (hard-to-guess prefix; the store is public)
//
// The ledger is shared by all family members because the quota belongs to the
// API key, not to a person. It never stores script text — only sizes, timing
// and outcomes. See docs/USAGE_LOG.md for the entry format.

const SCHEMA_VERSION = 1;
const MAX_EVENTS_SHOWN = 150;

export function dailyLimit() {
  const configured = Number.parseInt(process.env.GEMINI_DAILY_LIMIT, 10);
  return configured > 0 ? configured : DEFAULT_DAILY_CALL_LIMIT;
}

function dayKey(day) {
  if (!usingBlob()) return `usage/${day}.json`;
  const secret = crypto.createHash("sha256").update(`usage:${process.env.NEXTAUTH_SECRET || ""}`).digest("hex");
  return `usage/${secret.slice(0, 16)}/${day}.json`;
}

export function shiftDay(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

async function readDay(day) {
  return (await readJsonFresh(dayKey(day))) ?? { v: SCHEMA_VERSION, day, events: [] };
}

// Writes are serialized inside one server instance so parallel requests
// can't overwrite each other's read-modify-write.
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function todayView(events, limit, now) {
  return {
    day: quotaDay(now),
    ...summarizeDay(events, limit),
    resetAt: nextQuotaReset(now).toISOString(),
  };
}

// Appends one entry. Never throws: losing a log line must not fail a
// generation that already cost quota. Returns today's numbers, or an error.
export function recordUsage(event) {
  const limit = dailyLimit();
  return serialized(async () => {
    const at = new Date(event.ts);
    try {
      const file = await readDay(quotaDay(at));
      file.events.push(event);
      await writeJson(dayKey(file.day), file);
      return { usage: todayView(file.events, limit, at), error: null };
    } catch (error) {
      console.error("[usage-log] could not write entry:", error.message);
      return { usage: null, error: error.message };
    }
  });
}

// A manual correction, e.g. after calls were made outside this app.
export function adjustUsage(used, user) {
  return recordUsage({
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    type: "adjust",
    used,
    user,
  });
}

// Today's numbers plus a per-day history, for the usage panel.
export async function getUsageOverview({ days = 14, now = new Date() } = {}) {
  const limit = dailyLimit();
  const today = quotaDay(now);
  const dayList = Array.from({ length: days }, (_, i) => shiftDay(today, i - days + 1));
  const errors = [];

  const files = await Promise.all(dayList.map(async (day) => {
    try {
      return await readDay(day);
    } catch (error) {
      errors.push(`${day}: ${error.message}`);
      return { day, events: [] };
    }
  }));

  const todayFile = files.at(-1);
  return {
    limit,
    storage: usingBlob() ? "blob" : "local",
    today: {
      ...todayView(todayFile.events, limit, now),
      events: todayFile.events.slice(-MAX_EVENTS_SHOWN).reverse(),
    },
    days: files.map((file) => ({ day: file.day, ...summarizeDay(file.events, limit) })),
    errors,
  };
}

// Raw entries for the last `days` days (oldest first), for downloading.
export async function exportUsage({ days = 90, now = new Date() } = {}) {
  const today = quotaDay(now);
  const dayList = Array.from({ length: days }, (_, i) => shiftDay(today, i - days + 1));
  const files = await Promise.all(dayList.map((day) => readDay(day).catch(() => null)));
  return files.filter((file) => file?.events.length);
}
