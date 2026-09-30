import test from "node:test";
import assert from "node:assert/strict";
import { findPauseCuts } from "../lib/shared/wavSplit.js";

const RATE = 24000;

// Speech-like bursts separated by pauses of the given lengths (seconds).
function recording(parts) {
  const chunks = [];
  for (const { speech, pause } of parts) {
    const s = new Int16Array(Math.round(speech * RATE));
    for (let i = 0; i < s.length; i++) s[i] = Math.round(Math.sin(i / 7) * 9000);
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

test("a line break the model made short is still found by where the text says it should be", () => {
  // Line 2 ends with only a 0.5 s pause, but the in-line pause near it is far away.
  const pcm = recording([
    { speech: 2, pause: 3.0 },
    { speech: 1, pause: 0.35 }, { speech: 1, pause: 0.5 },
    { speech: 2.5, pause: 0 },
  ]);
  const result = findPauseCuts(pcm, RATE, [20, 20, 25]);
  assert.equal(result.ok, true);
  const [a, b, c] = result.ranges.map(([from, to]) => seconds(to - from));
  assert.ok(a > 2 && a < 2.5, `first line ${a}`);
  assert.ok(b > 2 && b < 3, `second line ${b}`);
  assert.ok(c > 2.4, `third line ${c}`);
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
