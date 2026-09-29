import {
  MAX_CHARS_PER_CALL,
  MAX_SPEAKERS_PER_CALL,
  MAX_TURNS_PER_CALL,
  isDesignedVoice,
} from "./config.js";
import { requestSignature } from "./ttsRequest.js";
import { splitText } from "./textSplit.js";

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

export function planCalls(turns) {
  const pieces = splitLongTurns(turns);
  const calls = makeSpeechGroups(pieces).map((group, index) => {
    const callTurns = group.map(cleanTurn);
    return {
      index,
      turns: callTurns,
      chars: callTurns.reduce((sum, turn) => sum + turn.text.length, 0),
      firstLine: group[0].sourceIndex,
      lastLine: group.at(-1).sourceIndex,
      signature: requestSignature(callTurns),
    };
  });
  return { calls, chars: calls.reduce((sum, call) => sum + call.chars, 0) };
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
