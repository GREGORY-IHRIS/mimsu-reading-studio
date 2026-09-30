import {
  MAX_CHARS_PER_CALL,
  MAX_SPEAKERS_PER_CALL,
  MAX_TURNS_PER_CALL,
  isDesignedVoice,
} from "./config.js";
import { requestSignature } from "./ttsRequest.js";
import { splitText } from "./textSplit.js";
import { PAUSE_SEPARATOR, PAUSE_STYLE, PAUSE_TAG, sentenceEnds } from "./wavSplit.js";

// Turns a script into the smallest ordered list of Gemini calls.
//
//   turns  ─splitLongTurns→  pieces  ─makeSpeechGroups→  groups  ─→  calls
//
// One "call" is exactly one HTTP request to Gemini and therefore one unit of
// the daily quota, so everything here is about needing fewer of them.

// A turn longer than one call can carry is cut into pieces of the same
// speaker, voice and style.
export function splitLongTurns(turns) {
  return turns
    .flatMap((turn, sourceIndex) =>
      splitText(turn.text, MAX_CHARS_PER_CALL).map((text) => ({
        speaker: turn.speaker,
        voice: turn.voice,
        style: turn.style || "",
        text,
        sourceIndex,
      }))
    )
    .map((piece, index) => ({ ...piece, index }));
}

// Minimum number of ordered calls. A group may hold up to MAX_SPEAKERS_PER_CALL
// speakers (each turn can then carry its own style) or a single speaker with
// one shared style. Designed voices cannot share a call with another speaker.
export function makeSpeechGroups(turns) {
  const best = Array(turns.length + 1).fill(Infinity);
  const next = Array(turns.length);
  best[turns.length] = 0;

  for (let start = turns.length - 1; start >= 0; start--) {
    const speakers = new Map();
    let chars = 0;
    let sameStyle = true;
    for (let end = start; end < turns.length && end - start < MAX_TURNS_PER_CALL; end++) {
      const turn = turns[end];
      chars += turn.text.length;
      if (chars > MAX_CHARS_PER_CALL) break;
      if (speakers.has(turn.speaker) && speakers.get(turn.speaker) !== turn.voice) break;
      speakers.set(turn.speaker, turn.voice);
      if (speakers.size > MAX_SPEAKERS_PER_CALL) break;
      if (speakers.size > 1 && [...speakers.values()].some(isDesignedVoice)) break;
      if ((turn.style || "") !== (turns[start].style || "")) sameStyle = false;
      if ((speakers.size > 1 || sameStyle) && 1 + best[end + 1] <= best[start]) {
        best[start] = 1 + best[end + 1];
        next[start] = end + 1;
      }
    }
    if (next[start] === undefined) {
      throw new Error("한 줄이 Gemini 한 번의 호출 한도를 넘어요.");
    }
  }

  const groups = [];
  for (let start = 0; start < turns.length; start = next[start]) {
    groups.push(turns.slice(start, next[start]));
  }
  return groups;
}

const cleanTurn = ({ speaker, voice, style, text }) => ({ speaker, voice, style: style || "", text });

// Pieces that follow each other in the script, as separate runs. A call that
// is read in plain order can only cover such a run: its audio is one piece of
// sound that cannot have other lines put in between afterwards.
function adjacentRuns(pieces) {
  const runs = [];
  for (const piece of pieces) {
    const run = runs.at(-1);
    if (run && piece.index === run.at(-1).index + 1) run.push(piece);
    else runs.push([piece]);
  }
  return runs;
}

function sequenceCalls(pieces) {
  return adjacentRuns(pieces).flatMap((run) => makeSpeechGroups(run).map((group) => {
    const turns = group.map(cleanTurn);
    return {
      turns,
      chars: turns.reduce((sum, turn) => sum + turn.text.length, 0),
      firstLine: group[0].sourceIndex,
      lastLine: group.at(-1).sourceIndex,
      pieceIndices: group.map((piece) => piece.index),
      cut: null,
    };
  }));
}

// ── Plans that read many lines in one call and cut the audio apart again ─────
//
// Lines that already contain a pause tag would confuse the cut-by-silence step.
const HAS_PAUSE_TAG = /<\s*(long|short)\s+pause\s*>|\[(길게|짧게) 멈춤\]/i;

// The delivery note of a line that must be followed by a long, clear pause.
const withPauseStyle = (style) => (style ? `${style} ${PAUSE_STYLE}` : PAUSE_STYLE);

// A piece's share of a cut call: its text plus the pause tag that follows it.
const cost = (piece) => piece.text.length + PAUSE_SEPARATOR.length;
const callChars = (parts) => parts.reduce((sum, part) => sum + part.chars, 0) - PAUSE_SEPARATOR.length;
const callTurns = (parts) => parts.reduce((sum, part) => sum + part.pieces.length, 0);

// Cuts one voice's pieces (script order) into parts that each fit in a call.
function chunkPieces(pieces) {
  const parts = [];
  let current = null;
  for (const piece of pieces) {
    if (current && (callChars([current]) + cost(piece) > MAX_CHARS_PER_CALL || current.pieces.length >= MAX_TURNS_PER_CALL)) current = null;
    if (!current) {
      current = { pieces: [], chars: 0 };
      parts.push(current);
    }
    current.pieces.push(piece);
    current.chars += cost(piece);
  }
  return parts;
}

// The line info the cutter needs (see lib/shared/wavSplit.js).
const cutInfo = (piece, group) => ({ pieceIndex: piece.index, chars: piece.text.length, ends: sentenceEnds(piece.text), group });

const spanOf = (pieces) => ({
  firstLine: Math.min(...pieces.map((piece) => piece.sourceIndex)),
  lastLine: Math.max(...pieces.map((piece) => piece.sourceIndex)),
});

// One voice, one shared style: all its lines as ONE turn, tag-separated.
function singleVoiceCall(part) {
  const first = part.pieces[0];
  return {
    turns: [{
      speaker: first.speaker, voice: first.voice,
      style: part.pieces.length > 1 ? withPauseStyle(first.style) : first.style || "",
      text: part.pieces.map((piece) => piece.text).join(PAUSE_SEPARATOR),
    }],
    chars: callChars([part]),
    ...spanOf(part.pieces),
    pieceIndices: part.pieces.map((piece) => piece.index),
    cut: { lines: part.pieces.map((piece) => cutInfo(piece, 0)) },
  };
}

// Two voices: a conversation in script order, every turn but the last ending
// with the pause tag. A speaker keeps the same label all the way through.
function pairCall(first, second) {
  const pieces = [...first.pieces, ...second.pieces].sort((a, b) => a.index - b.index);
  const voices = [first.pieces[0].voice, second.pieces[0].voice];
  const labels = voices.map((voice) => pieces.find((piece) => piece.voice === voice).speaker);
  if (labels[0] === labels[1]) labels[1] = `${labels[1]}·2`;
  const turns = pieces.map((piece, i) => ({
    speaker: labels[voices.indexOf(piece.voice)],
    voice: piece.voice,
    style: i < pieces.length - 1 ? withPauseStyle(piece.style) : piece.style || "",
    text: i < pieces.length - 1 ? `${piece.text} ${PAUSE_TAG}` : piece.text,
  }));
  return {
    turns,
    chars: callChars([first, second]),
    ...spanOf(pieces),
    pieceIndices: pieces.map((piece) => piece.index),
    cut: { lines: pieces.map((piece) => cutInfo(piece, voices.indexOf(piece.voice))) },
  };
}

// "Per-voice" plan: ALL lines of one voice (+ style) in one single-speaker
// call. The number of calls is the number of voices, not the number of times
// the speaker changes. Returns null when it cannot be used.
function voiceCalls(pieces) {
  if (pieces.some((piece) => HAS_PAUSE_TAG.test(piece.text))) return null;
  const streams = new Map();
  for (const piece of pieces) {
    const key = `${piece.voice}\u0000${piece.style || ""}`;
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(piece);
  }
  return [...streams.values()].flatMap(chunkPieces).map(singleVoiceCall).sort(byFirstPiece);
}

// "Pair" plan: two voices per call. Each voice's lines are cut into parts that
// fit a call, and parts are paired up (biggest with the smallest that still
// fits), so n voices need about n/2 calls. Designed voices and a voice's
// second style stay in single-voice calls.
function pairCalls(pieces) {
  if (pieces.some((piece) => HAS_PAUSE_TAG.test(piece.text))) return null;

  const streams = new Map();
  for (const piece of pieces) {
    const key = isDesignedVoice(piece.voice) ? `${piece.voice}\u0000${piece.style || ""}` : piece.voice;
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(piece);
  }

  const single = [];
  const parts = [];
  for (const stream of streams.values()) {
    if (isDesignedVoice(stream[0].voice)) {
      single.push(...chunkPieces(stream));
    } else {
      parts.push(...chunkPieces(stream));
    }
  }

  // Pair up. Sorting by size (ties by position) keeps the result stable.
  parts.sort((a, b) => b.chars - a.chars || a.pieces[0].index - b.pieces[0].index);
  const calls = [];
  let low = 0;
  let high = parts.length - 1;
  while (low <= high) {
    const big = parts[low++];
    const small = low <= high ? parts[high] : null;
    if (small && callChars([big, small]) <= MAX_CHARS_PER_CALL && callTurns([big, small]) <= MAX_TURNS_PER_CALL) {
      high--;
      calls.push(pairCall(big, small));
    } else {
      calls.push(...singleVoiceParts(big).map(singleVoiceCall));
    }
  }
  return [...calls, ...single.map(singleVoiceCall)].sort(byFirstPiece);
}

// A part of one voice that ends up alone in its call must not mix styles
// (a single-speaker request has one shared style): one call per style.
function singleVoiceParts(part) {
  const byStyle = new Map();
  for (const piece of part.pieces) {
    const style = piece.style || "";
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style).push(piece);
  }
  return [...byStyle.values()].map((pieces) => ({ pieces, chars: pieces.reduce((sum, piece) => sum + cost(piece), 0) }));
}

const byFirstPiece = (a, b) => a.pieceIndices[0] - b.pieceIndices[0];

// The cheapest way to read `pieces` (the whole script, or what is still
// missing after an earlier round). mode "sequence" forces plain in-order calls.
//   plan = { mode: "sequence" | "voices" | "pairs", calls, chars, pieceCount }
// In "voices" and "pairs" mode a call's audio holds several lines that must be
// cut apart again (call.cut.lines; see lib/client/resolveLines.js). Ties go
// to the plan that needs no cutting.
export function planPieces(pieces, { mode = "auto" } = {}) {
  let planMode = "sequence";
  let calls = sequenceCalls(pieces);
  if (mode !== "sequence") {
    for (const [name, build] of [["voices", voiceCalls], ["pairs", pairCalls]]) {
      const candidate = build(pieces);
      if (candidate && candidate.length < calls.length) {
        planMode = name;
        calls = candidate;
      }
    }
  }
  calls = calls.map((call, index) => ({ ...call, index, signature: requestSignature(call.turns) }));
  return {
    mode: planMode,
    calls,
    chars: pieces.reduce((sum, piece) => sum + piece.text.length, 0),
    pieceCount: pieces.length,
  };
}

export function planCalls(turns, options) {
  return planPieces(splitLongTurns(turns), options);
}

// Rejects anything a single Gemini call cannot carry. Used by the server so a
// hand-crafted request can't waste quota, and by the browser before sending.
export function validateCall(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return "읽을 대사가 없어요.";
  if (turns.length > MAX_TURNS_PER_CALL) return `한 번에 대사 ${MAX_TURNS_PER_CALL}줄까지만 보낼 수 있어요.`;

  const speakers = new Map();
  let chars = 0;
  for (const turn of turns) {
    if (!turn?.speaker || !turn?.voice || !turn?.text) return "화자·목소리·대사가 빠진 줄이 있어요.";
    if (speakers.has(turn.speaker) && speakers.get(turn.speaker) !== turn.voice) {
      return `"${turn.speaker}"에게 서로 다른 목소리가 지정됐어요.`;
    }
    speakers.set(turn.speaker, turn.voice);
    chars += turn.text.length;
  }
  if (chars > MAX_CHARS_PER_CALL) return `한 번에 ${MAX_CHARS_PER_CALL}자까지만 보낼 수 있어요.`;
  if (speakers.size > MAX_SPEAKERS_PER_CALL) return `한 번에 화자 ${MAX_SPEAKERS_PER_CALL}명까지만 보낼 수 있어요.`;
  if (speakers.size > 1 && [...speakers.values()].some(isDesignedVoice)) {
    return "직접 만든 목소리는 다른 화자와 한 번에 보낼 수 없어요.";
  }
  if (speakers.size === 1 && turns.some((turn) => (turn.style || "") !== (turns[0].style || ""))) {
    return "한 화자 묶음 안에서 연기 톤이 서로 달라요.";
  }
  return null;
}

// Fallback when Gemini rejects a multi-speaker group: the same lines as
// separate single-voice calls, merging neighbours with the same speaker+style.
export function splitIntoRuns(turns) {
  const runs = [];
  for (const turn of turns) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (last && last.speaker === turn.speaker && last.voice === turn.voice && last.style === turn.style) {
      run.push(turn);
    } else {
      runs.push([turn]);
    }
  }
  return runs;
}
