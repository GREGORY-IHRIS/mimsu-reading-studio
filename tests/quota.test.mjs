import test from "node:test";
import assert from "node:assert/strict";
import { classifyGeminiFailure, retryHintMs } from "../lib/shared/geminiErrors.js";
import { assessBudget, nextQuotaReset, quotaDay, summarizeDay } from "../lib/shared/quota.js";
import { createRateLimiter } from "../lib/shared/rateLimiter.js";

const call = (outcome, extra = {}) => ({ type: "call", bucket: "tts", purpose: "script", outcome, ts: "2026-09-29T00:00:00Z", ...extra });

test("the quota day follows Pacific time, not Korean time", () => {
  // 2026-09-29 16:30 KST = 07:30 UTC = 00:30 PDT on the 29th
  assert.equal(quotaDay(new Date("2026-09-29T07:30:00Z")), "2026-09-29");
  // one hour earlier it is still the 28th in California
  assert.equal(quotaDay(new Date("2026-09-29T06:30:00Z")), "2026-09-28");
});

test("the daily reset is 16:00 KST in summer time and 17:00 KST in winter time", () => {
  assert.equal(nextQuotaReset(new Date("2026-09-29T02:00:00Z")).toISOString(), "2026-09-29T07:00:00.000Z");
  assert.equal(nextQuotaReset(new Date("2026-12-10T02:00:00Z")).toISOString(), "2026-12-10T08:00:00.000Z");
  // exactly at midnight the next reset is a full day away
  assert.equal(nextQuotaReset(new Date("2026-09-29T07:00:00Z")).toISOString(), "2026-09-30T07:00:00.000Z");
});

test("only answered calls and server-side failures count toward the limit", () => {
  const summary = summarizeDay([
    call("ok"), call("ok"), call("error"), call("timeout"),
    call("rate_limited"), call("rejected"), call("network"),
    call("ok", { bucket: "text" }), call("ok", { bucket: "meta" }),
  ]);
  assert.equal(summary.used, 4);
  assert.equal(summary.remaining, 96);
  assert.equal(summary.total, 9);
});

test("a daily-quota refusal from Gemini overrides our own count", () => {
  const summary = summarizeDay([call("ok"), call("quota_exhausted", { ts: "2026-09-29T01:00:00Z" })]);
  assert.equal(summary.used, 1);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.exhaustedAt, "2026-09-29T01:00:00Z");
});

test("a manual adjustment resets the count and clears the exhausted flag", () => {
  const summary = summarizeDay([
    call("ok"), call("quota_exhausted"), { type: "adjust", used: 40, ts: "2026-09-29T02:00:00Z" }, call("ok"),
  ]);
  assert.equal(summary.used, 41);
  assert.equal(summary.remaining, 59);
  assert.equal(summary.exhaustedAt, null);
});

test("budget assessment warns before a job that does not fit", () => {
  const usage = (remaining) => ({ remaining, limit: 100 });
  assert.equal(assessBudget({ needed: 10, usage: usage(80) }).level, "ok");
  assert.equal(assessBudget({ needed: 75, usage: usage(80) }).level, "tight");
  assert.deepEqual(
    (({ level, needsConfirm }) => ({ level, needsConfirm }))(assessBudget({ needed: 30, usage: usage(12) })),
    { level: "over", needsConfirm: true }
  );
  assert.equal(assessBudget({ needed: 3, usage: usage(0) }).level, "exhausted");
  assert.equal(assessBudget({ needed: 0, usage: usage(0) }).needsConfirm, false);
  assert.equal(assessBudget({ needed: 5, usage: null }).needsConfirm, false);
});

test("Gemini failures are classified for the log and the browser", () => {
  assert.equal(classifyGeminiFailure(429, "Please retry in 10h37m25s").code, "QUOTA_DAILY");
  assert.equal(classifyGeminiFailure(429, "Quota exceeded for metric ... requests per day").code, "QUOTA_DAILY");
  assert.equal(classifyGeminiFailure(429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier").code, "QUOTA_DAILY");
  const minute = classifyGeminiFailure(429, "Please retry in 21.5s");
  assert.equal(minute.code, "RATE_LIMIT");
  assert.equal(minute.retryAfterMs, 21_500);
  assert.equal(classifyGeminiFailure(429, "Resource exhausted").code, "RATE_LIMIT");
  assert.equal(classifyGeminiFailure(400, "Invalid input received.").code, "REJECTED");
  assert.equal(classifyGeminiFailure(403, "denied").code, "AUTH");
  assert.equal(classifyGeminiFailure(503, "overloaded").outcome, "error");
});

test("retry hints parse compound durations and ignore prose", () => {
  assert.equal(retryHintMs("Please retry in 10h37m25s"), 38_245_000);
  assert.equal(retryHintMs("nothing useful"), null);
});

test("the rate limiter waits for the oldest request to leave the window", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
  assert.equal(limiter.waitMs(), 0);
  limiter.record();
  now = 10_000;
  limiter.record();
  assert.equal(limiter.waitMs(), 50_000);
  now = 60_001;
  assert.equal(limiter.waitMs(), 0);
});
