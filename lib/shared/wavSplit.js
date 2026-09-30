// Cutting one long recording back into its lines.
//
// "Per-voice" mode (see voiceCalls in scriptPlan.js) reads all lines of one
// voice in a single Gemini call, separated by a long-pause tag. We know the
// text of every line, so there are two independent clues about where a line
// ends in the audio:
//   1. the model leaves a pause there. How long it is varies a lot between
//      runs (measured 2026-09-30: 0.5 s … 10 s; pauses inside a sentence
//      stay below ~0.8 s), so length alone is not enough;
//   2. the line is about as long in seconds as its share of the characters.
// The cut points are the silences that fit both best. When two candidates
// fit about equally well, or the best fit is off, the split is refused
// rather than guessed (the caller then generates the clip again).

export const PAUSE_TAG = "<long pause>";
export const PAUSE_SEPARATOR = ` ${PAUSE_TAG} `;

const WINDOW_S = 0.02;
const SILENCE_RATIO = 0.012;   // a window is silent below 1.2 % of the peak level
const CANDIDATE_S = 0.3;       // shorter silences are never line breaks
const MIN_CUT_S = 0.4;         // a chosen line break must be at least this long
const KEEP_S = 0.12;           // silence left on each side of a cut

// Position prior. Times are "speech time": the recording without its pauses.
const POSITION_TOLERANCE_S = 1.0;    // one unit of cost per this much misplacement…
const POSITION_TOLERANCE_REL = 0.06; // …or this fraction of the whole recording
const ACCEPT_OFFSET_S = 1.5;         // a chosen cut may be this far from where the text says…
const ACCEPT_OFFSET_REL = 0.08;      // …or this fraction of the recording
const LENGTH_BONUS_MAX = 2;          // cost credit for a pause of 1.5 s or more
const LENGTH_BONUS_FULL_S = 1.5;

// Each cut-out line must last roughly as long as its share of the text says.
const SHARE_SLACK_S = 1.2;
const SHARE_TOLERANCE = 0.6;

function silentRuns(pcm, sampleRate) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = pcm.length >> 1;
  const win = Math.max(1, Math.round(sampleRate * WINDOW_S));
  const windows = Math.floor(samples / win);

  let peak = 0;
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(view.getInt16(i * 2, true)));
  if (peak === 0) return null;
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
      if (start > 0 && w < windows) runs.push({ from: start, to: w, seconds: (w - start) * WINDOW_S });
      start = -1;
    }
  }
  return { runs, win, samples };
}

// Picks one candidate per line break, in order, with the lowest total cost.
function chooseCuts(candidates, targets, tolerance) {
  const need = targets.length;
  const cost = (candidate, k) => {
    const misplacement = (candidate.at - targets[k]) / tolerance;
    const credit = Math.min(1, Math.max(0, (candidate.seconds - CANDIDATE_S) / (LENGTH_BONUS_FULL_S - CANDIDATE_S)));
    return misplacement * misplacement - LENGTH_BONUS_MAX * credit;
  };

  // best[k][j]: cheapest way to place breaks 0..k with break k at candidate j.
  const best = Array.from({ length: need }, () => Array(candidates.length).fill(Infinity));
  const from = Array.from({ length: need }, () => Array(candidates.length).fill(-1));
  candidates.forEach((candidate, j) => { best[0][j] = cost(candidate, 0); });
  for (let k = 1; k < need; k++) {
    for (let j = 0; j < candidates.length; j++) {
      for (let i = 0; i < j; i++) {
        const total = best[k - 1][i] + cost(candidates[j], k);
        if (total < best[k][j]) { best[k][j] = total; from[k][j] = i; }
      }
    }
  }

  let end = -1;
  for (let j = 0; j < candidates.length; j++) if (end < 0 || best[need - 1][j] < best[need - 1][end]) end = j;
  if (end < 0 || best[need - 1][end] === Infinity) return null;
  const picked = [];
  for (let k = need - 1, j = end; k >= 0; j = from[k][j], k--) picked.unshift(j);
  return picked;
}

// `pcm`: 16-bit little-endian mono samples (no header). `weights`: the number
// of characters of each line, in order.
// Returns { ok: true, ranges: [[startByte, endByte], …], gaps } with one range
// per line, or { ok: false, reason }.
export function findPauseCuts(pcm, sampleRate, weights) {
  const lines = weights.length;
  if (lines <= 1) return { ok: true, ranges: [[0, pcm.length]], gaps: [] };

  const found = silentRuns(pcm, sampleRate);
  if (!found) return { ok: false, reason: "소리가 비어 있어요." };
  const { runs, win, samples } = found;

  // Candidates with their position in speech time.
  const candidates = runs.filter((run) => run.seconds >= CANDIDATE_S);
  let paused = 0;
  for (const run of candidates) {
    run.at = (run.from * win) / sampleRate - paused;
    paused += run.seconds;
  }
  const need = lines - 1;
  if (candidates.length < need) {
    return { ok: false, reason: `줄 사이 쉼을 ${candidates.length}개만 찾았어요 (필요 ${need}개).` };
  }

  const speech = samples / sampleRate - paused;
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  let acc = 0;
  const targets = weights.slice(0, need).map((weight) => { acc += weight; return (speech * acc) / weightSum; });
  const tolerance = Math.max(POSITION_TOLERANCE_S, speech * POSITION_TOLERANCE_REL);

  const picked = chooseCuts(candidates, targets, tolerance);
  if (!picked) return { ok: false, reason: "줄 사이 쉼 위치를 정하지 못했어요." };

  // Refuse when a cut is too short, too far from where the text says it should
  // be, or when another silence would have been about as good a choice.
  const acceptOffset = Math.max(ACCEPT_OFFSET_S, speech * ACCEPT_OFFSET_REL);
  for (let k = 0; k < need; k++) {
    const chosen = candidates[picked[k]];
    const offset = Math.abs(chosen.at - targets[k]);
    if (chosen.seconds < MIN_CUT_S) return { ok: false, reason: "줄 사이 쉼이 너무 짧아요." };
    if (offset > acceptOffset) return { ok: false, reason: "쉼 위치가 글자 수와 맞지 않아요." };
    const rival = candidates.find((other, j) => !picked.includes(j)
      && Math.abs(other.at - targets[k]) <= acceptOffset
      && other.seconds >= chosen.seconds * 0.8
      && Math.abs(other.at - targets[k]) <= 2 * offset + 0.5);
    if (rival) return { ok: false, reason: "줄 사이 쉼과 문장 안의 쉼이 구분되지 않아요." };
  }

  const keep = Math.round(sampleRate * KEEP_S);
  const ranges = [];
  let begin = 0;
  for (const index of picked) {
    const run = candidates[index];
    const middle = Math.round(((run.from + run.to) / 2) * win);
    ranges.push([begin * 2, Math.min(run.from * win + keep, middle) * 2]);
    begin = Math.max(run.to * win - keep, middle);
  }
  ranges.push([begin * 2, samples * 2]);

  const total = ranges.reduce((sum, [start, end]) => sum + (end - start), 0) / 2 / sampleRate;
  const misfit = ranges.some(([start, end], i) => {
    const expected = (total * weights[i]) / weightSum;
    return Math.abs((end - start) / 2 / sampleRate - expected) > Math.max(SHARE_SLACK_S, expected * SHARE_TOLERANCE);
  });
  if (misfit) return { ok: false, reason: "잘라 낸 길이가 글자 수와 맞지 않아요." };

  return { ok: true, ranges, gaps: picked.map((index) => +candidates[index].seconds.toFixed(2)) };
}
