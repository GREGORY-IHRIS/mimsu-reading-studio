export const BATCH_SIZE = 60;
// Plan speech requests before wrapping them in server batches. The 1000-char
// ceiling keeps each synthesis bounded; batching must not split a speech group.
export const BATCH_CHARS = 1000;
export const REQUESTS_PER_WINDOW = 8;
export const RATE_WINDOW_MS = 62_000;

export function requestCapacity(recentRequests, count, now = Date.now()) {
  const active = recentRequests.filter((at) => now - at < RATE_WINDOW_MS);
  return {
    active,
    waitMs: active.length + count > REQUESTS_PER_WINDOW
      ? Math.max(0, active[0] + RATE_WINDOW_MS - now)
      : 0,
  };
}

// Layouts 1 and 2 reproduce the old boundaries for browser-cached clips.
export function makeBatches(turns, { layout = 3 } = {}) {
  if (layout === 1) return makeLegacyBatches(turns, 8, 400);
  if (layout === 2) return makeLegacyBatches(turns, 20, 1000);

  const pieces = [];
  turns.forEach((turn, sourceIndex) => {
    let remaining = turn.text;
    while (remaining) {
      let cut = Math.min(remaining.length, BATCH_CHARS);
      if (cut < remaining.length) {
        const space = remaining.lastIndexOf(" ", cut);
        if (space >= BATCH_CHARS / 2) cut = space + 1;
      }
      const text = remaining.slice(0, cut).trim();
      remaining = remaining.slice(cut).trim();
      if (text) pieces.push({ ...turn, text, sourceIndex });
    }
  });

  const groups = makeSpeechGroups(pieces);
  const batches = [];
  let batchGroups = [];
  let chars = 0;
  let turnCount = 0;
  function flush() {
    if (!batchGroups.length) return;
    const entries = batchGroups.flat();
    batches.push({
      start: entries[0].sourceIndex,
      end: entries.at(-1).sourceIndex,
      turns: entries.map(({ sourceIndex, ...turn }) => turn),
    });
    batchGroups = [];
    chars = 0;
    turnCount = 0;
  }
  for (const group of groups) {
    const groupChars = group.reduce((sum, turn) => sum + turn.text.length, 0);
    if (batchGroups.length && (
      batchGroups.length >= REQUESTS_PER_WINDOW ||
      turnCount + group.length > BATCH_SIZE ||
      chars + groupChars > BATCH_CHARS
    )) flush();
    batchGroups.push(group);
    chars += groupChars;
    turnCount += group.length;
  }
  flush();
  return batches;
}

function makeLegacyBatches(turns, maxTurns, maxChars) {
  const batches = [];
  let batch = [];
  let chars = 0;
  let start = 0;
  let end = 0;
  turns.forEach((turn, index) => {
    let remaining = turn.text;
    while (remaining) {
      let cut = Math.min(remaining.length, maxChars);
      if (cut < remaining.length) {
        const space = remaining.lastIndexOf(" ", cut);
        if (space >= maxChars / 2) cut = space + 1;
      }
      const piece = remaining.slice(0, cut).trim();
      remaining = remaining.slice(cut).trim();
      if (!piece) continue;
      const candidate = { ...turn, text: piece };
      if (batch.length && (
        batch.length >= maxTurns ||
        chars + piece.length > maxChars ||
        makeSpeechGroupsGreedy([...batch, candidate]).length > REQUESTS_PER_WINDOW
      )) {
        batches.push({ start, end, turns: batch });
        batch = [];
        chars = 0;
      }
      if (batch.length === 0) start = index;
      batch.push(candidate);
      chars += piece.length;
      end = index;
    }
  });
  if (batch.length) batches.push({ start, end, turns: batch });
  return batches;
}

// The old greedy planner is only used to preserve layout 2 cache boundaries.
function makeSpeechGroupsGreedy(turns) {
  const groups = [];
  let group = [];
  function canJoin(turn) {
    const candidate = [...group, turn];
    const speakers = new Map();
    for (const item of candidate) {
      if (speakers.has(item.speaker) && speakers.get(item.speaker) !== item.voice) return false;
      speakers.set(item.speaker, item.voice);
    }
    if (speakers.size > 2) return false;
    if (speakers.size === 2) return [...speakers.values()].every((voice) => !voice.startsWith("voice_"));
    return candidate.every((item) => item.style === candidate[0].style);
  }
  for (const turn of turns) {
    if (group.length && !canJoin(turn)) {
      groups.push(group);
      group = [];
    }
    group.push(turn);
  }
  if (group.length) groups.push(group);
  return groups;
}

// Minimum number of ordered Gemini calls within the per-call limits. A
// two-speaker group can carry a separate style annotation on every turn.
// Designed voices still require their own single-speaker calls.
export function makeSpeechGroups(turns) {
  const best = Array(turns.length + 1).fill(Infinity);
  const next = Array(turns.length);
  best[turns.length] = 0;
  for (let start = turns.length - 1; start >= 0; start--) {
    const speakers = new Map();
    let chars = 0;
    let sameStyle = true;
    for (let end = start; end < turns.length && end - start < BATCH_SIZE; end++) {
      const turn = turns[end];
      chars += turn.text.length;
      if (chars > BATCH_CHARS) break;
      if (speakers.has(turn.speaker) && speakers.get(turn.speaker) !== turn.voice) break;
      speakers.set(turn.speaker, turn.voice);
      if (speakers.size > 2) break;
      if (speakers.size === 2 && [...speakers.values()].some((voice) => voice.startsWith("voice_"))) break;
      if (turn.style !== turns[start].style) sameStyle = false;
      if ((speakers.size === 2 || sameStyle) && 1 + best[end + 1] <= best[start]) {
        best[start] = 1 + best[end + 1];
        next[start] = end + 1;
      }
    }
  }
  const groups = [];
  for (let start = 0; start < turns.length; start = next[start]) {
    groups.push(turns.slice(start, next[start]));
  }
  return groups;
}

export function retryHintMs(message) {
  const hint = message.match(/retry\s+in\s+([\d.a-z\s]+)/i)?.[1]?.split(/\s+or\b/i)[0]?.trim();
  if (!hint) return null;
  const units = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, second: 1000, seconds: 1000, m: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000 };
  const parts = [...hint.matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?|ms|[smhd])/gi)];
  if (!parts.length || parts.map((part) => part[0].replace(/\s+/g, "")).join("") !== hint.replace(/\s+/g, "")) return null;
  return parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2].toLowerCase()], 0);
}
