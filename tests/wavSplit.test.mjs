import test from "node:test";
import assert from "node:assert/strict";
import { cutLines, findPauseCuts } from "../lib/shared/wavSplit.js";

const RATE = 24000;

// Speech-like bursts separated by pauses of the given lengths (seconds).
function recording(parts) {
  const chunks = [];
  for (const { speech, pause, level = 9000 } of parts) {
    const s = new Int16Array(Math.round(speech * RATE));
    for (let i = 0; i < s.length; i++) s[i] = Math.round(Math.sin(i / 7) * level);
    chunks.push(s, new Int16Array(Math.round(pause * RATE)));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Int16Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new Uint8Array(all.buffer);
}

const seconds = (bytes) => bytes / 2 / RATE;

test("cuts at the long pauses and ignores short ones inside a line", () => {
  // line 1 has a 0.3 s comma pause inside; lines are separated by ~1.1 s.
  const pcm = recording([
    { speech: 1, pause: 0.3 }, { speech: 1, pause: 1.1 },
    { speech: 2, pause: 1.0 },
    { speech: 1.5, pause: 0.4 }, { speech: 1, pause: 0 },
  ]);
  const result = findPauseCuts(pcm, RATE, [23, 20, 25]);
  assert.equal(result.ok, true);
  assert.equal(result.ranges.length, 3);
  const [a, b, c] = result.ranges.map(([from, to]) => seconds(to - from));
  assert.ok(a > 2.3 && a < 3, `first line ${a}`);
  assert.ok(b > 2 && b < 2.6, `second line ${b}`);
  assert.ok(c > 2.5, `third line ${c}`);
  // Nothing lost or duplicated: ranges are in order and non-overlapping.
  for (let i = 1; i < result.ranges.length; i++) assert.ok(result.ranges[i][0] >= result.ranges[i - 1][1] - 1);
});

test("refuses to guess when in-line pauses are as long as line breaks", () => {
  const pcm = recording([
    { speech: 1, pause: 1.0 }, { speech: 1, pause: 0.95 }, { speech: 1, pause: 1.0 }, { speech: 1, pause: 0 },
  ]);
  const result = findPauseCuts(pcm, RATE, [10, 10, 10]);
  assert.equal(result.ok, false);
});

test("refuses when there are fewer pauses than lines", () => {
  const pcm = recording([{ speech: 1, pause: 1.2 }, { speech: 1, pause: 0 }]);
  assert.equal(findPauseCuts(pcm, RATE, [1, 1, 1, 1]).ok, false);
});

test("one piece needs no cutting", () => {
  const pcm = recording([{ speech: 1, pause: 0 }]);
  const result = findPauseCuts(pcm, RATE, [12]);
  assert.deepEqual(result.ranges, [[0, pcm.length]]);
});

test("leading and trailing silence are not treated as line breaks", () => {
  const pcm = recording([{ speech: 0.05, pause: 1.5 }, { speech: 1, pause: 1.5 }]);
  // Only one real boundary exists, between the two speech bursts.
  assert.equal(findPauseCuts(pcm, RATE, [1, 20]).ok, true);
  assert.equal(findPauseCuts(pcm, RATE, [1, 10, 10]).ok, false);
});

test("a cut inside a sentence is caught by the length check", () => {
  // Three clear pauses but the text says the lines are 1 : 1 : 30 characters.
  const pcm = recording([{ speech: 3, pause: 1.2 }, { speech: 3, pause: 1.2 }, { speech: 3, pause: 0 }]);
  assert.equal(findPauseCuts(pcm, RATE, [30, 1, 1]).ok, false);
  assert.equal(findPauseCuts(pcm, RATE, [10, 10, 10]).ok, true);
});

test("a line break the model made short is never trusted, only the lines around clear breaks are kept", () => {
  // The break after line 2 is only 0.5 s long — as long as a pause inside a sentence.
  const pcm = recording([
    { speech: 2, pause: 3.0 },
    { speech: 1, pause: 0.35 }, { speech: 1, pause: 0.5 },
    { speech: 2.5, pause: 0 },
  ]);
  assert.equal(findPauseCuts(pcm, RATE, [20, 20, 25]).ok, false);
  const result = cutLines(pcm, RATE, [20, 20, 25]);
  assert.deepEqual(result.ranges.map(Boolean), [true, false, false]);
  const [first] = result.ranges;
  assert.ok(seconds(first[1] - first[0]) > 1.9 && seconds(first[1] - first[0]) < 2.4);
});

test("a long pause inside a line is not mistaken for a line break", () => {
  // Line 1 contains a 1.3 s dramatic pause; the real break to line 2 is 3 s.
  const pcm = recording([
    { speech: 2, pause: 1.3 }, { speech: 2, pause: 3.0 }, { speech: 3.5, pause: 0 },
  ]);
  const result = findPauseCuts(pcm, RATE, [40, 35]);
  assert.equal(result.ok, true);
  const [a, b] = result.ranges.map(([from, to]) => seconds(to - from));
  assert.ok(a > 5 && a < 5.8, `first line ${a}`);
  assert.ok(b > 3.4 && b < 4.2, `second line ${b}`);
});

// ── line-by-line results ────────────────────────────────────────────────────

test("cutLines keeps the clear lines and marks only the unclear ones", () => {
  // Boundary 1|2 is a clear 1.4 s pause; boundary 2|3 is only 0.35 s and sits
  // where an in-line pause would be as well, so lines 2 and 3 stay open.
  const pcm = recording([
    { speech: 2, pause: 1.4 },
    { speech: 1.4, pause: 0.35 }, { speech: 1.4, pause: 0.4 },
    { speech: 2, pause: 1.4 },
    { speech: 2, pause: 0 },
  ]);
  const result = cutLines(pcm, RATE, [20, 28, 20, 20]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ranges.map(Boolean), [true, false, false, true]);
  assert.deepEqual(result.boundaries.map((boundary) => boundary.confident), [true, false, true]);
  assert.equal(result.resolved, result.ranges.filter(Boolean).length);
  assert.equal(findPauseCuts(pcm, RATE, [20, 28, 20, 20]).ok, result.ranges.every(Boolean));
});

test("cutLines resolves everything when every boundary is clear", () => {
  const pcm = recording([
    { speech: 2, pause: 1.3 }, { speech: 2.5, pause: 1.3 }, { speech: 1.5, pause: 1.3 }, { speech: 2, pause: 0 },
  ]);
  const result = cutLines(pcm, RATE, [20, 25, 15, 20]);
  assert.equal(result.resolved, 4);
  assert.ok(result.boundaries.every((boundary) => boundary.confident));
});

test("two voices with different speaking speeds are cut correctly", () => {
  // Voice 0 reads 10 chars per second, voice 1 only 6.
  const pcm = recording([
    { speech: 2, pause: 1.3 }, { speech: 5, pause: 1.3 }, { speech: 2.5, pause: 1.3 }, { speech: 5, pause: 0 },
  ]);
  const lines = [
    { chars: 20, ends: [], group: 0 }, { chars: 30, ends: [], group: 1 },
    { chars: 25, ends: [], group: 0 }, { chars: 30, ends: [], group: 1 },
  ];
  const result = cutLines(pcm, RATE, lines);
  assert.equal(result.resolved, 4);
  const lengths = result.ranges.map(([from, to]) => seconds(to - from));
  assert.ok(lengths[1] > 4.5 && lengths[1] < 5.5, `second line ${lengths[1]}`);
});

test("an unreadable recording resolves nothing instead of failing", () => {
  const silent = new Uint8Array(RATE * 2);
  assert.equal(cutLines(silent, RATE, [10, 10]).ok, false);
});

test("a quiet breath in the middle of a long pause does not make the cut ambiguous", () => {
  // A 3.3 s pause with 0.3 s of barely audible noise in its middle.
  const pcm = recording([
    { speech: 2, pause: 1.5 }, { speech: 0.3, level: 2500, pause: 1.5 }, { speech: 2, pause: 0 },
  ]);
  const result = cutLines(pcm, RATE, [20, 20]);
  assert.equal(result.resolved, 2);
  assert.ok(result.boundaries[0].seconds > 3.2, `one pause of ${result.boundaries[0].seconds} s`);
  assert.ok(result.boundaries[0].margin >= 5, `margin ${result.boundaries[0].margin}`);
});

test("a stretch of real speech between two long pauses is never swallowed by them", () => {
  // Same layout, but the middle sound is as loud as speech: it is not a breath,
  // so the two pauses stay two pauses.
  const pcm = recording([
    { speech: 2, pause: 1.5 }, { speech: 0.3, pause: 1.5 }, { speech: 2, pause: 0 },
  ]);
  const result = cutLines(pcm, RATE, [20, 20]);
  assert.ok(result.boundaries[0].seconds < 2, `pauses were merged: ${result.boundaries[0].seconds} s`);
});
