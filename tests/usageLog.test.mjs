import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The ledger writes under DATA_DIR, so point it at a throwaway folder before loading it.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-test-"));
process.env.DATA_DIR = dataDir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.GEMINI_DAILY_LIMIT;
const { adjustUsage, exportUsage, getUsageOverview, recordUsage, shiftDay } = await import("../lib/server/usageLog.js");

const now = new Date("2026-09-29T12:00:00Z");
const event = (id, outcome, extra = {}) => ({
  id, ts: now.toISOString(), type: "call", bucket: "tts", purpose: "script", outcome, http: 200, ms: 1000, chars: 500, ...extra,
});

test.after(() => fs.rm(dataDir, { recursive: true, force: true }));

test("entries accumulate in one file per quota day and feed today's numbers", async () => {
  await recordUsage(event("a", "ok"));
  await recordUsage(event("b", "ok"));
  const { usage } = await recordUsage(event("c", "rate_limited", { http: 429 }));
  assert.equal(usage.used, 2);
  assert.equal(usage.remaining, 98);
  assert.equal(usage.outcomes.rate_limited, 1);

  const file = JSON.parse(await fs.readFile(path.join(dataDir, "usage", "2026-09-29.json"), "utf-8"));
  assert.deepEqual(file.events.map((e) => e.id), ["a", "b", "c"]);
});

test("parallel writes are not lost", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => recordUsage(event(`p${i}`, "ok"))));
  const overview = await getUsageOverview({ days: 3, now });
  assert.equal(overview.today.used, 22);
});

test("the overview lists days oldest first with today last", async () => {
  const overview = await getUsageOverview({ days: 3, now });
  assert.deepEqual(overview.days.map((d) => d.day), ["2026-09-27", "2026-09-28", "2026-09-29"]);
  assert.equal(overview.days[2].used, 22);
  assert.equal(overview.limit, 100);
  assert.equal(overview.storage, "local");
});

test("a manual adjustment replaces the running count", async () => {
  // adjustUsage stamps "now", so use the real clock's day for this check
  await adjustUsage(7, "tester");
  const overview = await getUsageOverview({ days: 1 });
  assert.equal(overview.today.used, 7);
  assert.equal(overview.today.events[0].type, "adjust");
});

test("export returns raw entries of days that have any", async () => {
  const files = await exportUsage({ days: 5, now });
  assert.equal(files.length, 1);
  assert.equal(files[0].day, "2026-09-29");
  assert.ok(files[0].events.length >= 22);
});

test("shiftDay moves calendar dates across month ends", () => {
  assert.equal(shiftDay("2026-10-01", -1), "2026-09-30");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});
