// Cutting one long recording back into its lines.
//
// "Per-voice" and "pair" plans (see planCalls in scriptPlan.js) read many
// lines in one Gemini call, separated by a long-pause tag, and the browser
// cuts the audio apart again. Gemini returns plain audio without timestamps,
// but we know the text of every line, so we know what to look for:
//
//   * every line ends with a pause (the tag), and every sentence inside a
//     line ends with a shorter one;
//   * speech has a fairly constant speed (measured: about 0.11–0.15 s per
//     character with ~8 % spread), so the expected time of every one of those
//     pauses can be predicted from the character counts.
//
// The recording is scanned for silences, and the pauses we expect are aligned
// with the silences we found (dynamic programming). A silence is a better
// match the closer it sits to the time predicted from the *previous matched
// pause* (so speed differences do not add up over a long recording) and, for
// line ends, the longer it is. How long the model makes the tag pause varies
// wildly between runs (0.5 s … 10 s), which is why length alone cannot decide.
//
// The alignment is only accepted when it is unambiguous: for every line end,
// the best alignment that puts it on a different silence must cost clearly
// more (a "margin"). Otherwise the split is refused rather than guessed and
// the caller generates the clip again.

export const PAUSE_TAG = "<long pause>";
export const PAUSE_SEPARATOR = ` ${PAUSE_TAG} `;
// The tag alone gives pauses anywhere from 0.4 s to 2 s. Asking for the pause in
// words as well makes them long and unmistakable (measured: 6 – 14 s).
export const PAUSE_STYLE = "말을 마친 뒤 2초 정도 완전히 조용히 멈춘다.";

const WINDOW_S = 0.02;
const SILENCE_RATIO = 0.012;   // a window is silent below 1.2 % of the peak level
const CANDIDATE_S = 0.3;       // shorter silences are never line ends or sentence ends
const BLIP_S = 0.12;           // two silences with less speech than this between them are one pause
const SOFT_BLIP_S = 0.45;      // ... and so are two, one of them a long pause, with at most this much
const SOFT_BLIP_LEVEL = 0.4;   //     barely audible sound between them (below this share of the speech level: a breath, a click)
const MIN_CUT_S = 0.8;         // a line end must be at least this long: sentence pauses rarely are
const KEEP_S = 0.12;           // silence left on each side of a cut

// Alignment cost model.
const TOLERANCE_S = 0.3;       // timing error is measured in units of
const TOLERANCE_REL = 0.1;     //   max(TOLERANCE_S, TOLERANCE_REL × expected duration)
const LINE_END_BONUS = 4;      // credit for a line end on a pause of BONUS_FULL_S or more
const SENTENCE_END_BONUS = 0.5;
const BONUS_FULL_S = 1.2;
const MISSING_SENTENCE_END = 1.5; // a sentence end that left no silence
const MISSING_LINE_END = 6;    // a line end that left no visible pause
const UNEXPLAINED_FROM_S = 1.2; // a silence this long that no expected pause explains costs extra ...
const UNEXPLAINED_FULL_S = 2.5; // ... up to UNEXPLAINED_COST at this length: nothing but a tag pause is that long
const UNEXPLAINED_COST = 3;
const MAX_SKIPPED = 8;         // pauses that may be missing in a row
const MAX_ERROR_UNITS = 6;     // a stretch this far off from the text is never accepted
const MIN_MARGIN = 5;
const MAX_FIT = 3;             // a line end is only trusted when the stretches around it are this close to the text (units)
const MAX_LINE_ERROR = 4;      // no cut-out line may be off by more than this many units

// Character offsets, inside `text`, that end a sentence which is followed by
// more text. Used to predict the shorter pauses within a line.
export function sentenceEnds(text) {
  const ends = [];
  const pattern = /[.!?…。？！]+["'”’)\]]*(?=\s+\S)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) ends.push(match.index + match[0].length);
  return ends;
}

// A line is { chars, ends } (see sentenceEnds); a bare number means "no inner pauses".
const asLine = (line) => (typeof line === "number" ? { chars: line, ends: [] } : line);

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
  const levels = new Float64Array(windows);
  let lead = 0;
  let tail = 0;
  let start = -1;
  for (let w = 0; w <= windows; w++) {
    let silent = false;
    if (w < windows) {
      let energy = 0;
      for (let j = 0; j < win; j++) {
        const v = view.getInt16((w * win + j) * 2, true);
        energy += v * v;
      }
      levels[w] = energy / win;
      silent = levels[w] < limit;
    }
    if (silent && start < 0) start = w;
    if (!silent && start >= 0) {
      if (start === 0) lead = w;
      else if (w === windows) tail = w - start;
      else runs.push({ from: start, to: w, seconds: (w - start) * WINDOW_S });
      start = -1;
    }
  }
  if (start >= 0 && start > 0) tail = windows - start;
  return { runs, levels, limit, win, samples, lead: lead * WINDOW_S, tail: tail * WINDOW_S };
}

// A pause with a click or a breath in the middle shows up as two silences.
// Merge them, so that a cut is never "ambiguous" between the halves of one
// pause: a sliver of sound (BLIP_S), or, next to a long pause, a short stretch
// that is far quieter than the speech (SOFT_BLIP_S, SOFT_BLIP_LEVEL).
function mergeBlips({ runs, levels, limit }) {
  const loud = [];
  for (const level of levels) if (level >= limit) loud.push(level);
  loud.sort((a, b) => a - b);
  const speechLevel = loud.length ? loud[Math.floor(loud.length * 0.75)] : Infinity; // the loud part of speech, not its soft edges

  const soft = (from, to) => {
    let energy = 0;
    for (let w = from; w < to; w++) energy += levels[w];
    return energy / (to - from) < SOFT_BLIP_LEVEL ** 2 * speechLevel;
  };
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    const between = last ? (run.from - last.to) * WINDOW_S : Infinity;
    if (last && between < BLIP_S) {
      last.to = run.to;
      last.seconds += run.seconds;
    } else if (last && between <= SOFT_BLIP_S && Math.max(last.seconds, run.seconds) >= MIN_CUT_S && soft(last.to, run.from)) {
      last.to = run.to;
      last.seconds = (last.to - last.from) * WINDOW_S;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

// The pauses to look for, with the character position (over all lines) where each occurs.
function expectedPauses(lines) {
  const pauses = [];
  let position = 0;
  lines.forEach((line, i) => {
    for (const end of line.ends) if (end > 0 && end < line.chars) pauses.push({ line: false, position: position + end });
    position += line.chars;
    if (i < lines.length - 1) pauses.push({ line: true, position });
  });
  return { pauses, total: position };
}

// Aligns the expected pauses with the silences found (dynamic programming).
//
// Every expected pause is either matched with a silence or missing (the model
// left no visible pause there). A missing line end costs more than a missing
// sentence end, but far less than forcing it onto the wrong silence. Between
// two matched pauses the time that passed must agree with the text.
//
// Returns, for every line end, the silence it sits on (or -1 when it is
// missing) and its margin: how much worse the best alignment is that puts that
// line end on a different silence, or drops it.
function align(silences, pauses, total, speech, missingLineEnd) {
  const m = silences.length;
  const n = pauses.length;
  const rate = speech / total;

  // Nodes 0 … n+1: the start of the recording, the pauses, the end.
  // Places 0 … m+1: the start, the silences, the end. Both in speech time.
  const at = [0, ...silences.map((s) => s.at), speech];
  const expected = [0, ...pauses.map((p) => p.position * rate), total * rate];
  const isLine = [false, ...pauses.map((p) => p.line), false];
  const credit = [0, ...silences.map((s) => Math.min(1, Math.max(0, (s.seconds - CANDIDATE_S) / (BONUS_FULL_S - CANDIDATE_S)))), 0];

  // A long silence that no pause of the text explains is evidence against an
  // alignment: it usually means a line end was put on the wrong silence.
  const penaltySum = [0]; // penaltySum[j] = cost of leaving silences 1 … j unexplained
  silences.forEach((silence, index) => {
    const ramp = (silence.seconds - UNEXPLAINED_FROM_S) / (UNEXPLAINED_FULL_S - UNEXPLAINED_FROM_S);
    penaltySum.push(penaltySum[index] + UNEXPLAINED_COST * Math.min(1, Math.max(0, ramp)));
  });
  penaltySum.push(penaltySum[m]);
  const between = (i, j) => penaltySum[j - 1] - penaltySum[i]; // silences strictly between the places

  const unit = (wanted) => Math.max(TOLERANCE_S, TOLERANCE_REL * wanted);
  const interval = (observed, wanted) => ((observed - wanted) / unit(wanted)) ** 2;
  const node = (e, j) => (e === 0 || e === n + 1 ? 0 : -(isLine[e] ? LINE_END_BONUS : SENTENCE_END_BONUS) * credit[j]);
  const skipCost = (e) => (isLine[e] ? missingLineEnd : MISSING_SENTENCE_END);
  const skipSum = [0]; // skipSum[e] = cost of missing pauses 1 … e
  for (let e = 1; e <= n; e++) skipSum.push(skipSum[e - 1] + skipCost(e));
  const skipped = (from, to) => skipSum[to - 1] - skipSum[from]; // pauses strictly between the nodes

  // Indexes of the places whose time lies within [x, ...] (at is ascending).
  const firstAtLeast = (x) => { let lo = 0; let hi = m + 2; while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
  const lastAtMost = (x) => firstAtLeast(x + 1e-9) - 1;
  const range = (e) => (e === 0 ? [0, 0] : e === n + 1 ? [m + 1, m + 1] : [1, m]);
  const allowed = (wanted) => MAX_ERROR_UNITS * unit(wanted);

  // forward[e][j]: cheapest alignment of nodes 0..e with node e on place j.
  const forward = Array.from({ length: n + 2 }, () => new Float64Array(m + 2).fill(Infinity));
  const before = Array.from({ length: n + 2 }, () => new Int32Array(m + 2).fill(-1));
  const beforePlace = Array.from({ length: n + 2 }, () => new Int32Array(m + 2).fill(-1));
  forward[0][0] = 0;
  for (let e = 1; e <= n + 1; e++) {
    const [firstJ, lastJ] = range(e);
    for (let j = firstJ; j <= lastJ; j++) {
      let best = Infinity;
      for (let ep = e - 1; ep >= 0 && e - 1 - ep <= MAX_SKIPPED; ep--) {
        const wanted = expected[e] - expected[ep];
        const slack = allowed(wanted);
        const [firstI, lastI] = range(ep);
        const lo = Math.max(firstI, firstAtLeast(at[j] - wanted - slack));
        const hi = Math.min(lastI, j - 1, lastAtMost(at[j] - wanted + slack));
        const skip = skipped(ep, e);
        for (let i = lo; i <= hi; i++) {
          if (forward[ep][i] === Infinity) continue;
          const cost = forward[ep][i] + skip + interval(at[j] - at[i], wanted) + between(i, j);
          if (cost < best) { best = cost; before[e][j] = ep; beforePlace[e][j] = i; }
        }
      }
      if (best < Infinity) forward[e][j] = best + node(e, j);
    }
  }
  const bestTotal = forward[n + 1][m + 1];
  if (bestTotal === Infinity) return null;

  // backward[e][j]: cheapest way to finish, given node e on place j.
  const backward = Array.from({ length: n + 2 }, () => new Float64Array(m + 2).fill(Infinity));
  backward[n + 1][m + 1] = 0;
  for (let e = n; e >= 0; e--) {
    const [firstJ, lastJ] = range(e);
    for (let j = firstJ; j <= lastJ; j++) {
      let best = Infinity;
      for (let next = e + 1; next <= n + 1 && next - e - 1 <= MAX_SKIPPED; next++) {
        const wanted = expected[next] - expected[e];
        const slack = allowed(wanted);
        const [firstL, lastL] = range(next);
        const lo = Math.max(firstL, j + 1, firstAtLeast(at[j] + wanted - slack));
        const hi = Math.min(lastL, lastAtMost(at[j] + wanted + slack));
        const skip = skipped(e, next);
        for (let l = lo; l <= hi; l++) {
          if (backward[next][l] === Infinity) continue;
          const cost = skip + interval(at[l] - at[j], wanted) + between(j, l) + node(next, l) + backward[next][l];
          if (cost < best) best = cost;
        }
      }
      backward[e][j] = best;
    }
  }

  // The best alignment, walked back from the end.
  const chosen = new Map(); // pause node -> place
  for (let e = n + 1, j = m + 1; e > 0; ) {
    const ep = before[e][j];
    const jp = beforePlace[e][j];
    if (e <= n) chosen.set(e, j);
    e = ep;
    j = jp;
  }
  const path = [0, ...[...chosen.keys()].sort((a, b) => a - b), n + 1];
  const place = (e) => (e === 0 ? 0 : e === n + 1 ? m + 1 : chosen.get(e));
  const stretch = (a, b) => Math.abs(at[place(b)] - at[place(a)] - (expected[b] - expected[a])) / unit(expected[b] - expected[a]);

  const cuts = [];
  const margins = [];
  const fits = [];
  let missing = 0;
  pauses.forEach((pause, index) => {
    const e = index + 1;
    if (!chosen.has(e)) {
      if (pause.line) { cuts.push(-1); margins.push(0); fits.push(Infinity); } else { missing++; }
      return;
    }
    if (!pause.line) return;
    const j = chosen.get(e);
    const k = path.indexOf(e);
    const previous = path[k - 1];
    const next = path[k + 1];

    let rival = Infinity;
    for (let other = 1; other <= m; other++) {
      if (other !== j) rival = Math.min(rival, forward[e][other] + backward[e][other] - bestTotal);
    }
    // The same alignment with this line end dropped.
    if (next - previous - 1 <= MAX_SKIPPED) {
      const merged = interval(at[place(next)] - at[place(previous)], expected[next] - expected[previous])
        + between(place(previous), place(next));
      const now = interval(at[j] - at[place(previous)], expected[e] - expected[previous])
        + interval(at[place(next)] - at[j], expected[next] - expected[e]) + node(e, j)
        + between(place(previous), j) + between(j, place(next));
      rival = Math.min(rival, missingLineEnd + merged - now);
    }
    cuts.push(j - 1);
    margins.push(rival);
    fits.push(Math.max(stretch(previous, e), stretch(e, next)));
  });

  const matches = pauses.map((pause, index) => {
    const e = index + 1;
    const wanted = +expected[e].toFixed(2);
    return chosen.has(e)
      ? { line: pause.line, expected: wanted, at: +at[chosen.get(e)].toFixed(2), seconds: +silences[chosen.get(e) - 1].seconds.toFixed(2) }
      : { line: pause.line, expected: wanted, missing: true };
  });
  return { cuts, margins, fits, missing, rate, cost: bestTotal, matches };
}

// Two voices in one recording do not speak equally fast, so with two groups
// (voices) the second group's speed relative to the first is searched too.
const SPEED_RATIOS = [1, 0.9, 1.1, 0.82, 1.22];
const SPEED_PENALTY = 1; // cost per (ln ratio / 0.15)² — prefers "same speed" when nothing else is clearly better

function withSpeed(lines, ratio) {
  if (ratio === 1) return lines;
  const first = lines[0].group;
  return lines.map((line) => (line.group === first ? line : { ...line, chars: line.chars * ratio, ends: line.ends.map((end) => end * ratio) }));
}

// Cuts one recording into its lines. `pcm`: 16-bit little-endian mono samples
// (no header). `lineInfo`: for each line { chars, ends, group? } (see
// sentenceEnds; `group` tells the voices apart), or just its character count.
//
// Returns { ok, reason?, ranges, boundaries, resolved, detail }:
//   ranges[i]      [startByte, endByte] of line i, or null when line i could not
//                  be cut out with certainty (one of its two boundaries is unclear)
//   boundaries[i]  { seconds, margin, confident } for the pause after line i
//   resolved       how many lines have a range
//   ok             false only when nothing could be analysed at all
export function cutLines(pcm, sampleRate, lineInfo, { minMargin = MIN_MARGIN, maxFit = MAX_FIT, minCut = MIN_CUT_S, missingLineEnd = MISSING_LINE_END } = {}) {
  const input = lineInfo.map(asLine);
  if (input.length <= 1) {
    return { ok: true, ranges: [[0, pcm.length]], boundaries: [], resolved: input.length, detail: null };
  }

  const found = silentRuns(pcm, sampleRate);
  if (!found) return { ok: false, reason: "소리가 비어 있어요." };
  const { win, samples, lead, tail } = found;

  // Silences with their position in speech time (the recording minus its pauses).
  const silences = mergeBlips(found).filter((run) => run.seconds >= CANDIDATE_S);
  let paused = 0;
  for (const silence of silences) {
    silence.at = (silence.from * win) / sampleRate - lead - paused;
    paused += silence.seconds;
  }
  const speech = samples / sampleRate - lead - tail - paused;
  if (speech <= 0) return { ok: false, reason: "소리가 비어 있어요." };

  const twoVoices = new Set(input.map((line) => line.group)).size === 2;
  let best = null;
  for (const ratio of twoVoices ? SPEED_RATIOS : [1]) {
    const lines = withSpeed(input, ratio);
    const { pauses, total } = expectedPauses(lines);
    if (total <= 0) return { ok: false, reason: "소리가 비어 있어요." };
    const result = align(silences, pauses, total, speech, missingLineEnd);
    if (!result) continue;
    const cost = result.cost + SPEED_PENALTY * (Math.log(ratio) / 0.15) ** 2;
    if (!best || cost < best.cost) best = { ...result, cost, ratio, lines };
  }
  if (!best) return { ok: false, reason: "줄 사이 쉼 위치를 정하지 못했어요." };

  const { cuts, margins, fits, rate, lines } = best;
  const boundaries = cuts.map((index, i) => (index < 0
    ? { seconds: 0, margin: 0, fit: null, confident: false, missing: true }
    : {
      seconds: +silences[index].seconds.toFixed(2),
      margin: +margins[i].toFixed(1),
      fit: +fits[i].toFixed(1),
      confident: silences[index].seconds >= minCut && margins[i] >= minMargin && fits[i] <= maxFit,
    }));
  const detail = {
    speedRatio: best.ratio,
    cutSamples: cuts.map((index) => (index < 0 ? null : Math.round(((silences[index].from + silences[index].to) / 2) * win))),
    matches: best.matches,
    gaps: boundaries.map((b) => b.seconds),
    margins: boundaries.map((b) => b.margin),
    fits: boundaries.map((b) => b.fit),
  };

  const keep = Math.round(sampleRate * KEEP_S);
  const ranges = lines.map((line, i) => {
    if (i > 0 && !boundaries[i - 1].confident) return null;
    if (i < cuts.length && !boundaries[i].confident) return null;

    const from = i === 0 ? 0 : silences[cuts[i - 1]].at;
    const to = i === cuts.length ? speech : silences[cuts[i]].at;
    const wanted = rate * line.chars;
    if (Math.abs(to - from - wanted) > MAX_LINE_ERROR * Math.max(TOLERANCE_S, TOLERANCE_REL * wanted)) return null;

    let begin = 0;
    if (i > 0) {
      const silence = silences[cuts[i - 1]];
      begin = Math.max(silence.to * win - keep, Math.round(((silence.from + silence.to) / 2) * win));
    }
    let end = samples;
    if (i < cuts.length) {
      const silence = silences[cuts[i]];
      end = Math.min(silence.from * win + keep, Math.round(((silence.from + silence.to) / 2) * win));
    }
    return [begin * 2, end * 2];
  });

  return {
    ok: true,
    ranges,
    boundaries,
    resolved: ranges.filter(Boolean).length,
    missingSentenceEnds: best.missing,
    detail,
  };
}

// All-or-nothing form of cutLines: every line, or a reason why not.
export function findPauseCuts(pcm, sampleRate, lineInfo, options) {
  const result = cutLines(pcm, sampleRate, lineInfo, options);
  if (!result.ok) return result;
  if (result.ranges.every(Boolean)) {
    return {
      ok: true,
      ranges: result.ranges,
      gaps: result.detail?.gaps ?? [],
      minMargin: result.boundaries.length ? Math.min(...result.boundaries.map((b) => b.margin)) : Infinity,
      missingSentenceEnds: result.missingSentenceEnds,
      detail: result.detail,
    };
  }
  const shortGap = result.boundaries.some((b) => b.seconds < MIN_CUT_S);
  const reason = shortGap
    ? "줄 사이 쉼이 너무 짧아요."
    : result.boundaries.some((b) => !b.confident)
      ? "줄 사이 쉼과 문장 안의 쉼이 구분되지 않아요."
      : "잘라 낸 길이가 글자 수와 맞지 않아요.";
  return { ok: false, reason, detail: result.detail };
}
