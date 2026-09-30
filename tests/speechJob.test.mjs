import test from "node:test";
import assert from "node:assert/strict";
import { JobStopped, countUncached, runSpeechJob } from "../lib/client/speechJob.js";
import { MAX_CHARS_PER_CALL } from "../lib/shared/config.js";
import { planCalls } from "../lib/shared/scriptPlan.js";

const turn = (speaker, voice, text, style = "") => ({ speaker, voice, text, style });
// A fake clock: sleeping advances time instantly, so waits cost nothing in tests.
function fakeClock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; }, elapsed: () => time };
}
const fastSleep = () => Promise.resolve();

class ApiError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// An in-memory stand-in for the IndexedDB clip cache.
function memoryCache() {
  const store = new Map();
  return {
    store,
    keyFor: async (signature) => `k:${signature}`,
    get: async (key) => store.get(key) ?? null,
    has: async (key) => store.has(key),
    put: async (key, clip) => { store.set(key, clip); },
  };
}

// A fake /api/tts: `script` maps call number → an error to throw (or nothing).
function fakeSpeech(script = {}) {
  const sent = [];
  async function requestSpeech({ turns, job }) {
    sent.push({ turns, job });
    const failure = script[sent.length];
    if (failure) throw failure;
    return { clip: `audio(${turns.map((t) => t.text).join("|")})`, usage: { used: sent.length } };
  }
  return { sent, requestSpeech };
}

// Three speakers → three calls, whatever the per-call size limit is.
const body = Math.floor(MAX_CHARS_PER_CALL * 0.6);
const threeCalls = () => planCalls([
  turn("A", "Kore", "가".repeat(body)),
  turn("B", "Puck", "나".repeat(body)),
  turn("C", "Zephyr", "다".repeat(body)),
]).calls;

const joinClips = (parts) => `joined(${parts.join("+")})`;

test("each call is sent once, in order, and reported to the usage callback", async () => {
  const calls = threeCalls();
  const { sent, requestSpeech } = fakeSpeech();
  const usages = [];
  const { clips, stats } = await runSpeechJob({
    calls, purpose: "script", requestSpeech, joinClips, sleep: fastSleep, onUsage: (u) => usages.push(u),
  });
  assert.equal(calls.length, 3);
  assert.equal(sent.length, 3);
  assert.equal(clips.length, 3);
  assert.deepEqual(sent.map((s) => s.job.index), [0, 1, 2]);
  assert.ok(sent.every((s) => s.job.attempt === 1 && s.job.total === 3));
  assert.equal(stats.apiCalls, 3);
  assert.equal(usages.length, 3);
});

test("finished calls are cached, so a rerun sends nothing", async () => {
  const calls = threeCalls();
  const cache = memoryCache();
  await runSpeechJob({ calls, purpose: "script", requestSpeech: fakeSpeech().requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(await countUncached(calls, cache), 0);

  const again = fakeSpeech();
  const { stats } = await runSpeechJob({ calls, purpose: "script", requestSpeech: again.requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(again.sent.length, 0);
  assert.equal(stats.cached, 3);
});

test("the daily limit stops the job without retrying and keeps finished work", async () => {
  const calls = threeCalls();
  const cache = memoryCache();
  const daily = new ApiError("quota", "QUOTA_DAILY", { status: 429 });
  const { sent, requestSpeech } = fakeSpeech({ 3: daily });

  await assert.rejects(
    runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, cache, sleep: fastSleep }),
    (error) => error.code === "QUOTA_DAILY" && error.stats.done === 2 && error.lines[0] === 2
  );
  assert.equal(sent.length, 3, "no retry after a daily-limit refusal");
  assert.equal(cache.store.size, 2, "the two finished calls stay cached");

  // tomorrow: only the missing call is sent
  const tomorrow = fakeSpeech();
  await runSpeechJob({ calls, purpose: "script", requestSpeech: tomorrow.requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(tomorrow.sent.length, 1);
});

test("a per-minute refusal waits, then retries only that call", async () => {
  const calls = threeCalls();
  const { sent, requestSpeech } = fakeSpeech({ 2: new ApiError("slow down", "RATE_LIMIT", { status: 429, retryAfterMs: 5000 }) });
  const clock = fakeClock();
  await runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, sleep: clock.sleep, now: clock.now });
  assert.equal(sent.length, 4, "3 calls + 1 retry, never a re-send of finished calls");
  assert.deepEqual(sent.map((s) => s.job.attempt), [1, 1, 2, 1]);
  assert.equal(clock.elapsed(), 7000, "waited the 5 s Gemini asked for plus a 2 s margin");
});

test("repeated per-minute refusals give up after the retry budget", async () => {
  const calls = threeCalls().slice(0, 1);
  const refusal = () => new ApiError("slow down", "RATE_LIMIT", { status: 429, retryAfterMs: 1000 });
  const { sent, requestSpeech } = fakeSpeech({ 1: refusal(), 2: refusal(), 3: refusal(), 4: refusal() });
  const clock = fakeClock();
  await assert.rejects(runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, sleep: clock.sleep, now: clock.now }), { code: "RATE_LIMIT" });
  assert.equal(sent.length, 4);
});

test("a server error is retried once, then reported", async () => {
  const calls = threeCalls().slice(0, 1);
  const boom = () => new ApiError("upstream", "UPSTREAM", { status: 502 });
  const retried = fakeSpeech({ 1: boom() });
  const clock = fakeClock();
  await runSpeechJob({ calls, purpose: "script", requestSpeech: retried.requestSpeech, joinClips, sleep: clock.sleep, now: clock.now });
  assert.equal(retried.sent.length, 2);

  const failing = fakeSpeech({ 1: boom(), 2: boom() });
  const clock2 = fakeClock();
  await assert.rejects(runSpeechJob({ calls, purpose: "script", requestSpeech: failing.requestSpeech, joinClips, sleep: clock2.sleep, now: clock2.now }), { code: "UPSTREAM" });
  assert.equal(failing.sent.length, 2);
});

test("a rejected multi-speaker call is redone as single-voice runs, each cached", async () => {
  const calls = planCalls([turn("A", "Kore", "첫째"), turn("B", "Puck", "둘째"), turn("A", "Kore", "셋째")]).calls;
  assert.equal(calls.length, 1);
  const cache = memoryCache();
  const { sent, requestSpeech } = fakeSpeech({ 1: new ApiError("Invalid input", "REJECTED", { status: 400 }) });

  const { clips } = await runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(sent.length, 4, "1 rejected group + 3 single-voice runs");
  assert.equal(sent.slice(1).every((s) => s.job.fallback === true), true);
  assert.equal(clips[0], "joined(audio(첫째)+audio(둘째)+audio(셋째))");

  // the joined result is cached under the group too, so the rejection is never paid for twice
  const again = fakeSpeech();
  await runSpeechJob({ calls, purpose: "script", requestSpeech: again.requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(again.sent.length, 0);
});

test("a rejected single-voice call is reported, not split further", async () => {
  const calls = planCalls([turn("A", "Kore", "혼자")]).calls;
  const { sent, requestSpeech } = fakeSpeech({ 1: new ApiError("bad", "REJECTED", { status: 400 }) });
  await assert.rejects(runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, sleep: fastSleep }), { code: "REJECTED" });
  assert.equal(sent.length, 1);
});

test("stopping between calls keeps what is finished", async () => {
  const calls = threeCalls();
  const cache = memoryCache();
  let stop = false;
  const { requestSpeech } = fakeSpeech();
  await assert.rejects(
    runSpeechJob({
      calls, purpose: "script", cache, joinClips, sleep: fastSleep,
      requestSpeech: async (args) => { const result = await requestSpeech(args); stop = true; return result; },
      shouldStop: () => stop,
    }),
    JobStopped
  );
  assert.equal(cache.store.size, 1);
});

test("a broken cache never breaks generation", async () => {
  const calls = threeCalls();
  const brokenCache = {
    keyFor: async () => { throw new Error("no crypto"); },
    get: async () => { throw new Error("idb"); },
    has: async () => { throw new Error("idb"); },
    put: async () => { throw new Error("idb"); },
  };
  const { sent, requestSpeech } = fakeSpeech();
  await runSpeechJob({ calls, purpose: "script", requestSpeech, joinClips, cache: brokenCache, sleep: fastSleep });
  assert.equal(sent.length, 3);
  assert.equal(await countUncached(calls, brokenCache), 3);
});

test("a clip that fails the check is not cached, so only it is redone next time", async () => {
  const calls = threeCalls();
  const cache = memoryCache();
  const bad = new ApiError("cannot cut", "SPLIT_FAILED");
  const checkClip = async (clip, call) => { if (call.index === 1) throw bad; };

  const first = fakeSpeech();
  await assert.rejects(
    runSpeechJob({ calls, purpose: "script", requestSpeech: first.requestSpeech, joinClips, checkClip, cache, sleep: fastSleep }),
    (error) => error.code === "SPLIT_FAILED" && error.stats.done === 1
  );
  assert.equal(first.sent.length, 2, "the job stops at the bad clip");
  assert.equal(cache.store.size, 1, "the good clip stays cached, the bad one is not");

  const second = fakeSpeech();
  await runSpeechJob({ calls, purpose: "script", requestSpeech: second.requestSpeech, joinClips, cache, sleep: fastSleep });
  assert.equal(second.sent.length, 2);
});
