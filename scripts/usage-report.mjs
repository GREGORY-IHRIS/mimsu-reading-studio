// Summarizes the Gemini usage ledger: where the daily quota went and what was wasted.
//
//   npm run usage:report                       reads .data/usage/ (local development data)
//   npm run usage:report -- path/to/gemini-usage-2026-09-29.json   a file downloaded from the app's 사용량 panel
//   npm run usage:report -- --day 2026-09-29   only that (Pacific-time) day
//
// See docs/USAGE_LOG.md for the entry format and how to read the numbers.
import fs from "node:fs/promises";
import path from "node:path";
import { summarizeDay } from "../lib/shared/quota.js";

const args = process.argv.slice(2);
const dayFilter = args.includes("--day") ? args[args.indexOf("--day") + 1] : null;
const sources = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--day");
if (sources.length === 0) sources.push(path.join(process.env.DATA_DIR || ".data", "usage"));

async function loadDays(source) {
  const stat = await fs.stat(source);
  const files = stat.isDirectory()
    ? (await fs.readdir(source)).filter((name) => name.endsWith(".json")).map((name) => path.join(source, name))
    : [source];
  const days = [];
  for (const file of files) {
    const data = JSON.parse(await fs.readFile(file, "utf-8"));
    days.push(...(data.days ?? [data]));
  }
  return days;
}

const days = (await Promise.all(sources.map(loadDays))).flat()
  .filter((day) => day.events?.length && (!dayFilter || day.day === dayFilter))
  .sort((a, b) => a.day.localeCompare(b.day));

if (days.length === 0) {
  console.log("No usage entries found. (Production data: download it from the app's 사용량 panel first.)");
  process.exit(0);
}

const pad = (value, width) => String(value).padEnd(width);
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");

for (const day of days) {
  const calls = day.events.filter((event) => event.type !== "adjust");
  const tts = calls.filter((event) => event.bucket === "tts");
  const summary = summarizeDay(day.events);
  const counted = tts.filter((event) => ["ok", "error", "timeout"].includes(event.outcome));
  const chars = counted.reduce((sum, event) => sum + (event.chars || 0), 0);
  const seconds = counted.reduce((sum, event) => sum + event.ms, 0) / 1000;

  console.log(`\n══ ${day.day} ═══════════════════════════════════════════════`);
  console.log(`counted toward the daily limit: ${summary.used}   (exhausted flag: ${summary.exhaustedAt ?? "no"})`);
  console.log(`outcomes: ${Object.entries(summary.outcomes).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`by purpose: ${Object.entries(summary.purposes).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  if (counted.length) {
    console.log(`efficiency: ${Math.round(chars / counted.length)} chars per counted call, ${(seconds / counted.length).toFixed(1)} s per call, ${percent(counted.filter((e) => e.speakers > 1).length, counted.length)} were multi-speaker`);
  }

  // One row per button press (job id), so a single script can be followed through its retries.
  const jobs = new Map();
  for (const event of tts.filter((e) => e.job)) {
    const job = jobs.get(event.job.id) ?? { id: event.job.id, purpose: event.purpose, total: event.job.total, events: [] };
    job.events.push(event);
    jobs.set(event.job.id, job);
  }
  if (jobs.size) {
    console.log("\njobs (one per button press):");
    console.log(`  ${pad("job", 10)}${pad("time", 9)}${pad("purpose", 9)}${pad("planned", 8)}${pad("sent", 6)}${pad("counted", 8)}${pad("429", 5)}${pad("400", 5)}${pad("retries", 8)}${pad("split", 6)}chars`);
    for (const job of jobs.values()) {
      const sent = job.events.length;
      const jobCounted = job.events.filter((e) => ["ok", "error", "timeout"].includes(e.outcome));
      const spentPerIndex = new Map();
      for (const e of jobCounted.filter((e) => !e.job.fallback)) spentPerIndex.set(e.job.index, (spentPerIndex.get(e.job.index) || 0) + 1);
      const paidTwice = [...spentPerIndex.values()].filter((n) => n > 1).length;
      console.log(
        `  ${pad(job.id, 10)}${pad(job.events[0].ts.slice(11, 19), 9)}${pad(job.purpose, 9)}${pad(job.total, 8)}${pad(sent, 6)}${pad(jobCounted.length, 8)}` +
        `${pad(job.events.filter((e) => e.http === 429).length, 5)}${pad(job.events.filter((e) => e.outcome === "rejected").length, 5)}` +
        `${pad(job.events.filter((e) => e.job.attempt > 1).length, 8)}${pad(job.events.filter((e) => e.job.fallback).length, 6)}` +
        `${jobCounted.reduce((sum, e) => sum + (e.chars || 0), 0)}${paidTwice ? `   ⚠ ${paidTwice} call(s) paid for twice` : ""}`
      );
    }
  }

  const loose = tts.filter((event) => !event.job);
  if (loose.length) console.log(`\ncalls outside a job (previews, voice design): ${loose.length}`);
  const failures = calls.filter((event) => event.error);
  if (failures.length) {
    console.log("\nerrors:");
    for (const event of failures.slice(0, 15)) console.log(`  ${event.ts.slice(11, 19)} ${event.purpose} ${event.outcome} HTTP ${event.http}: ${event.error}`);
  }
}
