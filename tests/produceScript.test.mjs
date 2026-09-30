import test from "node:test";
import assert from "node:assert/strict";
import { produceScript } from "../lib/client/produceScript.js";
import { splitLongTurns } from "../lib/shared/scriptPlan.js";

// The round logic, with the network and the audio cutting replaced by fakes:
// a "clip" is just a list of piece indices, and `unclear` says which pieces the
// fake cutter cannot separate.

const turn = (speaker, voice, text) => ({ speaker, voice, text, style: "" });
const script = (voices = 4, lines = 16) =>
  Array.from({ length: lines }, (_, i) => turn(`화자${i % voices}`, `Voice${i % voices}`, `${i}번째 대사예요.`));

// A fake job runner: each call returns a clip naming its pieces, and records the plan.
function fakeRunner({ failWith } = {}) {
  const rounds = [];
  const runRound = async (plan, fresh, onClip) => {
    rounds.push({ plan, fresh });
    if (failWith && plan.mode !== "sequence") throw failWith;
    for (const call of plan.calls) {
      if ((await onClip({ pieces: call.pieceIndices }, call)) === "stop") break;
    }
  };
  return { rounds, runRound };
}

// The fake cutter: pieces in `unclear(round)` come back unresolved.
function fakeCutter(unclear = () => new Set()) {
  let attempt = 0;
  const cutClip = async (clip, lines) => {
    attempt++;
    const bad = unclear(attempt);
    const parts = lines.map((line) => (bad.has(line.pieceIndex) ? null : { pieces: [line.pieceIndex] }));
    return { parts, resolved: parts.filter(Boolean).length };
  };
  return cutClip;
}

const joinClips = async (blobs) => blobs.flatMap((blob) => blob.pieces);
const run = (turns, runner, cutClip) =>
  produceScript({ pieces: splitLongTurns(turns), runRound: runner.runRound, cutClip, joinClips });

test("when every cut is clear, one round of calls is enough", async () => {
  const runner = fakeRunner();
  const { audio, summary } = await run(script(), runner, fakeCutter());
  assert.deepEqual(audio, Array.from({ length: 16 }, (_, i) => i), "lines come back in script order");
  assert.equal(runner.rounds.length, 1);
  assert.equal(runner.rounds[0].plan.calls.length, 2);
  assert.equal(summary.calls, 2);
  assert.equal(summary.resolvedLines, 16);
});

test("lines that could not be cut are asked for again, and only those", async () => {
  const runner = fakeRunner();
  const unclear = (attempt) => (attempt <= 2 ? new Set([2, 3]) : new Set());
  const { audio } = await run(script(), runner, fakeCutter(unclear));
  assert.deepEqual(audio, Array.from({ length: 16 }, (_, i) => i));
  assert.equal(runner.rounds.length, 2);
  const second = runner.rounds[1].plan;
  assert.deepEqual(second.calls.flatMap((call) => call.pieceIndices).sort((a, b) => a - b), [2, 3]);
});

test("a call asked for twice in a run is marked fresh so the cache is not reused", async () => {
  const runner = fakeRunner();
  // The second call of round 1 comes back wholly unclear, so round 2 is that same request.
  const second = new Set([1, 2, 5, 6, 9, 10, 13, 14]);
  const unclear = (attempt) => (attempt === 2 ? second : new Set());
  await run(script(), runner, fakeCutter(unclear));
  assert.equal(runner.rounds.length, 2);
  assert.equal(runner.rounds[0].fresh.size, 0);
  assert.equal(runner.rounds[1].fresh.size, 1);
});

test("if cutting hardly works, the rest is read in plain order instead of retrying", async () => {
  const runner = fakeRunner();
  const everything = new Set(Array.from({ length: 16 }, (_, i) => i));
  const { audio, summary } = await run(script(), runner, fakeCutter(() => everything));
  assert.deepEqual(audio, Array.from({ length: 16 }, (_, i) => i));
  assert.equal(summary.fellBackToSequence, true);
  assert.equal(runner.rounds[0].plan.calls.length, 2);
  assert.equal(runner.rounds.at(-1).plan.mode, "sequence");
  // Only the first cut call was sent before giving up on cutting.
  assert.equal(summary.cutCalls, 1);
});

test("the final round is always plain order, however the cuts turn out", async () => {
  const runner = fakeRunner();
  // A little always stays unclear: piece 5 can never be cut.
  const { audio } = await run(script(), runner, fakeCutter(() => new Set([5])));
  assert.deepEqual(audio, Array.from({ length: 16 }, (_, i) => i));
  assert.ok(runner.rounds.length <= 4);
  assert.equal(runner.rounds.at(-1).plan.mode, "sequence");
});

test("a two-voice request Gemini refuses falls back to plain order", async () => {
  const refused = Object.assign(new Error("Invalid input"), { code: "REJECTED" });
  const runner = fakeRunner({ failWith: refused });
  const { audio, summary } = await run(script(), runner, fakeCutter());
  assert.deepEqual(audio, Array.from({ length: 16 }, (_, i) => i));
  assert.equal(summary.fellBackToSequence, true);
  assert.equal(runner.rounds.at(-1).plan.mode, "sequence");
});

test("other errors stop the job", async () => {
  const quota = Object.assign(new Error("quota"), { code: "QUOTA_DAILY" });
  const runner = fakeRunner({ failWith: quota });
  await assert.rejects(run(script(), runner, fakeCutter()), (error) => error.code === "QUOTA_DAILY");
});

test("a script with two voices needs no cutting at all", async () => {
  const runner = fakeRunner();
  const cutter = async () => { throw new Error("should not be called"); };
  const { audio, summary } = await run(script(2, 6), runner, cutter);
  assert.deepEqual(audio, [0, 1, 2, 3, 4, 5]);
  assert.equal(summary.cutCalls, 0);
  assert.equal(runner.rounds.length, 1);
});
