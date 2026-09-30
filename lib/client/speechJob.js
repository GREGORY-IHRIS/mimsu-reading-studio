import { splitIntoRuns } from "../shared/scriptPlan.js";
import { requestSignature } from "../shared/ttsRequest.js";

// Runs a planned list of Gemini calls one after another, spending as few
// quota units as possible:
//   - a call whose exact request was generated before is taken from the
//     browser cache instead of being sent again;
//   - every finished call is cached right away, so a failure or the daily
//     limit never throws away work that already cost quota;
//   - calls go out one at a time, and refused ones (HTTP 429) are retried
//     only after the wait Gemini asked for.
//
// Everything that touches the network, storage or time is passed in, so the
// policy in this file can be tested without a browser.

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 1;
const TRANSIENT_DELAY_MS = 5_000;
const MAX_RATE_LIMIT_WAIT_MS = 5 * 60_000;

export class JobStopped extends Error {
  constructor() {
    super("생성을 중지했어요.");
    this.name = "JobStopped";
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ignoreErrors = async (task) => { try { return await task(); } catch { return null; } };

export async function runSpeechJob({
  calls,
  purpose,
  requestSpeech,
  joinClips,
  onClip = async () => {},
  fresh = new Set(),
  cache = null,
  limiter = { waitMs: () => 0, record() {} },
  onProgress = () => {},
  onUsage = () => {},
  shouldStop = () => false,
  sleep = defaultSleep,
  now = Date.now,
  jobId = Math.random().toString(36).slice(2, 10),
}) {
  const stats = { total: calls.length, done: 0, cached: 0, apiCalls: 0, fallbackCalls: 0 };
  const report = (extra = {}) => onProgress({ ...stats, ...extra });

  function checkStop() {
    if (shouldStop()) throw new JobStopped();
  }

  async function wait(ms) {
    // Measured against the clock, not by counting ticks: background tabs run timers late.
    const until = now() + ms;
    for (let left = ms; left > 0; left = until - now()) {
      checkStop();
      report({ waitSeconds: Math.ceil(left / 1000) });
      await sleep(Math.min(1000, left));
    }
    report();
  }

  async function callGemini(call, fallback) {
    let rateRetries = 0;
    let transientRetries = 0;
    for (let attempt = 1; ; attempt++) {
      while (limiter.waitMs() > 0) await wait(limiter.waitMs());
      checkStop();
      limiter.record();
      try {
        const job = { id: jobId, index: call.index, total: calls.length, attempt, fallback };
        const { clip, usage } = await requestSpeech({ turns: call.turns, purpose, job });
        stats.apiCalls++;
        onUsage(usage);
        return clip;
      } catch (error) {
        if (error.usage) onUsage(error.usage);
        if (error.code === "RATE_LIMIT" && rateRetries < MAX_RATE_LIMIT_RETRIES) {
          rateRetries++;
          await wait(Math.min(error.retryAfterMs ?? 60_000, MAX_RATE_LIMIT_WAIT_MS) + 2_000);
          continue;
        }
        if ((error.code === "UPSTREAM" || error.code === "NETWORK") && transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          await wait(TRANSIENT_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
  }

  // If Gemini refuses a multi-speaker group, redo it as single-voice runs.
  // Each run is cached by itself, so this costs quota only once.
  async function generate(call, fallback) {
    try {
      return await callGemini(call, fallback);
    } catch (error) {
      // A call that will be cut apart again cannot be redone piecemeal.
      const runs = error.code === "REJECTED" && !fallback && !call.cut ? splitIntoRuns(call.turns) : [];
      if (runs.length < 2) throw error;
      stats.fallbackCalls += runs.length;
      const parts = [];
      for (const run of runs) {
        parts.push(await produce({ index: call.index, turns: run, signature: requestSignature(run) }, true));
      }
      return joinClips(parts);
    }
  }

  async function produce(call, fallback = false) {
    const key = cache ? await ignoreErrors(() => cache.keyFor(call.signature)) : null;
    // `fresh`: the same request was already answered in this job and did not
    // help, so ask again instead of taking the same answer from the cache.
    const hit = key && !fresh.has(call.signature) ? await ignoreErrors(() => cache.get(key)) : null;
    if (hit) {
      stats.cached++;
      return hit;
    }
    const clip = await generate(call, fallback);
    if (key) await ignoreErrors(() => cache.put(key, clip));
    return clip;
  }

  const clips = [];
  let stopped = false;
  report();
  for (const call of calls) {
    checkStop();
    try {
      const clip = await produce(call);
      clips.push(clip);
      // The caller looks at what came back; "stop" leaves the rest unmade.
      stopped = (await onClip(clip, call)) === "stop";
    } catch (error) {
      error.lines = [call.firstLine, call.lastLine];
      error.stats = { ...stats };
      throw error;
    }
    stats.done++;
    report();
    if (stopped) break;
  }
  return { clips, stats, stopped };
}

// How many of `calls` are not in the cache yet, i.e. how much quota the job
// will actually spend. A missing/broken cache means everything is uncached.
export async function countUncached(calls, cache) {
  if (!cache) return calls.length;
  const misses = await Promise.all(calls.map((call) => ignoreErrors(async () => {
    return !(await cache.has(await cache.keyFor(call.signature)));
  })));
  return misses.filter((miss) => miss !== false).length;
}
