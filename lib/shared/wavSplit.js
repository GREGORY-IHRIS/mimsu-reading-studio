// Cutting one long recording back into its lines.
//
// "Per-voice" mode (see planByVoice in scriptPlan.js) reads all lines of one
// voice in a single Gemini call, separated by a long-pause tag. The pauses
// the model leaves there are clearly longer than the ones inside a sentence
// (measured 2026-09-30: >= 0.98 s at the tags, <= 0.46 s elsewhere), so the
// cut points are simply the longest silences. If they are not clearly the
// longest, the split is refused rather than guessed.

export const PAUSE_TAG = "<long pause>";
export const PAUSE_SEPARATOR = ` ${PAUSE_TAG} `;

const WINDOW_S = 0.02;
const SILENCE_RATIO = 0.012;   // a window is silent below 1.2 % of the peak level
const MIN_BOUNDARY_S = 0.55;   // a line break is at least this long
const MARGIN = 1.25;           // ...and this much longer than the next-longest pause
const KEEP_S = 0.12;           // silence left on each side of a cut
// Each cut-out line must last roughly as long as its share of the text says,
// otherwise a cut landed inside a sentence instead of between lines.
const SHARE_SLACK_S = 1.2;
const SHARE_TOLERANCE = 0.6;

// `pcm`: 16-bit little-endian mono samples (no header). `weights`: the number
// of characters of each line, in order.
// Returns { ok: true, ranges: [[startByte, endByte], …] } with one range per
// line, or { ok: false, reason }.
export function findPauseCuts(pcm, sampleRate, weights) {
  const pieces = weights.length;
  if (pieces <= 1) return { ok: true, ranges: [[0, pcm.length]] };

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = pcm.length >> 1;
  const win = Math.max(1, Math.round(sampleRate * WINDOW_S));
  const windows = Math.floor(samples / win);

  let peak = 0;
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(view.getInt16(i * 2, true)));
  if (peak === 0) return { ok: false, reason: "소리가 비어 있어요." };
  const limit = (peak * SILENCE_RATIO) ** 2;

  const runs = [];
  let start = -1;
  for (let w = 0; w <= windows; w++) {
    let silent = false;
    if (w < windows) {
      let energy = 0;
      for (let j = 0; j < win; j++) {
        const v = view.getInt16((w * win + j) * 2, true);
        energy += v * v;
      }
      silent = energy / win < limit;
    }
    if (silent && start < 0) start = w;
    if (!silent && start >= 0) {
      // Silence at the very start or end is not a boundary between lines.
      if (start > 0 && w < windows) runs.push({ from: start, to: w, length: w - start });
      start = -1;
    }
  }

  const need = pieces - 1;
  if (runs.length < need) return { ok: false, reason: `줄 사이 쉼을 ${runs.length}개만 찾았어요 (필요 ${need}개).` };

  runs.sort((a, b) => b.length - a.length);
  const chosen = runs.slice(0, need);
  const shortest = chosen[need - 1].length;
  if (shortest * WINDOW_S < MIN_BOUNDARY_S) return { ok: false, reason: "줄 사이 쉼이 너무 짧아요." };
  if (runs[need] && shortest < runs[need].length * MARGIN) {
    return { ok: false, reason: "줄 사이 쉼과 문장 안의 쉼이 구분되지 않아요." };
  }

  chosen.sort((a, b) => a.from - b.from);
  const keep = Math.round(sampleRate * KEEP_S);
  const ranges = [];
  let begin = 0;
  for (const run of chosen) {
    const middle = Math.round(((run.from + run.to) / 2) * win);
    ranges.push([begin * 2, Math.min(run.from * win + keep, middle) * 2]);
    begin = Math.max(run.to * win - keep, middle);
  }
  ranges.push([begin * 2, samples * 2]);

  const total = ranges.reduce((sum, [from, to]) => sum + (to - from), 0) / 2 / sampleRate;
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const misfit = ranges.some(([from, to], i) => {
    const expected = (total * weights[i]) / weightSum;
    return Math.abs((to - from) / 2 / sampleRate - expected) > Math.max(SHARE_SLACK_S, expected * SHARE_TOLERANCE);
  });
  if (misfit) return { ok: false, reason: "잘라 낸 길이가 글자 수와 맞지 않아요." };
  return { ok: true, ranges };
}
