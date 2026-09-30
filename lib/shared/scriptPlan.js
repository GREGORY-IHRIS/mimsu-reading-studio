import {
  MAX_CHARS_PER_CALL,
  MAX_SPEAKERS_PER_CALL,
  MAX_TURNS_PER_CALL,
  isDesignedVoice,
} from "./config.js";
import { requestSignature } from "./ttsRequest.js";
import { splitText } from "./textSplit.js";
import { PAUSE_SEPARATOR } from "./wavSplit.js";

// Turns a script into the smallest ordered list of Gemini calls.
//
//   turns  ─splitLongTurns→  pieces  ─makeSpeechGroups→  groups  ─→  calls
//
// One "call" is exactly one HTTP request to Gemini and therefore one unit of
// the daily quota, so everything here is about needing fewer of them.

// A turn longer than one call can carry is cut into pieces of the same
// speaker, voice and style.
export function splitLongTurns(turns) {
  return turns.flatMap((turn, sourceIndex) =>
    splitText(turn.text, MAX_CHARS_PER_CALL).map((text) => ({
      speaker: turn.speaker,
      voice: turn.voice,
      style: turn.style || "",
      text,
      sourceIndex,
    }))
  );
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

function sequenceCalls(pieces) {
  return makeSpeechGroups(pieces).map((group) => {
    const turns = group.map(cleanTurn);
    return {
      turns,
      chars: turns.reduce((sum, turn) => sum + turn.text.length, 0),
      firstLine: group[0].sourceIndex,
      lastLine: group.at(-1).sourceIndex,
    };
  });
}

// Lines that already contain a pause tag would confuse the cut-by-silence step.
const HAS_PAUSE_TAG = /<\s*(long|short)\s+pause\s*>|\[(길게|짧게) 멈춤\]/i;

// "Per-voice" plan: ALL lines of one voice (+ style) go into one single-speaker
// call, in script order, separated by a long-pause tag; the browser cuts the
// audio back into lines at those pauses (lib/shared/wavSplit.js). The number
// of calls is then the number of voices instead of the number of times the
// speaker changes — 4 characters trading lines is 4 calls, not 9+.
// Returns null when it cannot be used.
function voiceCalls(pieces) {
  if (pieces.some((piece) => HAS_PAUSE_TAG.test(piece.text))) return null;

  const streams = new Map();
  pieces.forEach((piece, index) => {
    const key = `${piece.voice}\u0000${piece.style || ""}`;
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push({ piece, index });
  });

  const calls = [];
  for (const items of streams.values()) {
    let chunk = [];
    let chars = 0;
    const flush = () => {
      if (!chunk.length) return;
      const first = chunk[0].piece;
      calls.push({
        turns: [{
          speaker: first.speaker, voice: first.voice, style: first.style || "",
          text: chunk.map((item) => item.piece.text).join(PAUSE_SEPARATOR),
        }],
        chars,
        firstLine: Math.min(...chunk.map((item) => item.piece.sourceIndex)),
        lastLine: Math.max(...chunk.map((item) => item.piece.sourceIndex)),
        pieceIndices: chunk.map((item) => item.index),
        pieceChars: chunk.map((item) => item.piece.text.length),
      });
      chunk = [];
      chars = 0;
    };
    for (const item of items) {
      const added = item.piece.text.length + (chunk.length ? PAUSE_SEPARATOR.length : 0);
      if (chunk.length && (chars + added > MAX_CHARS_PER_CALL || chunk.length >= MAX_TURNS_PER_CALL)) flush();
      chars += item.piece.text.length + (chunk.length ? PAUSE_SEPARATOR.length : 0);
      chunk.push(item);
    }
    flush();
  }
  return calls.sort((a, b) => a.pieceIndices[0] - b.pieceIndices[0]);
}

// The cheapest way to read the script. mode "sequence" forces the plain
// in-order plan (used when cutting a per-voice recording apart failed).
//   plan = { mode: "sequence" | "voices", calls, chars, pieceCount }
// In "voices" mode a call's audio holds call.pieceIndices.length lines that
// must be cut apart again; see assembleByVoice in lib/client/generate.js.
export function planCalls(turns, { mode = "auto" } = {}) {
  const pieces = splitLongTurns(turns);
  let planMode = "sequence";
  let calls = sequenceCalls(pieces);
  if (mode !== "sequence") {
    const byVoice = voiceCalls(pieces);
    if (byVoice && byVoice.length < calls.length) {
      planMode = "voices";
      calls = byVoice;
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
