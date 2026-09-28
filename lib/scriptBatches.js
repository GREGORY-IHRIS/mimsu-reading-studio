export const BATCH_SIZE = 8;
// Preview audio is streamed, so batches can be larger without the 4.5 MB
// response cap. Keep synthesis inside the function's 60s deadline.
export const BATCH_CHARS = 400;
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

// Keep both the request count and expected WAV response size small. A long
// individual turn is split without changing its speaker or delivery style.
export function makeBatches(turns) {
  const batches = [];
  let batch = [];
  let chars = 0;
  let start = 0;
  let end = 0;
  turns.forEach((turn, index) => {
    let remaining = turn.text;
    while (remaining) {
      let cut = Math.min(remaining.length, BATCH_CHARS);
      if (cut < remaining.length) {
        const space = remaining.lastIndexOf(" ", cut);
        if (space >= BATCH_CHARS / 2) cut = space + 1;
      }
      const piece = remaining.slice(0, cut).trim();
      remaining = remaining.slice(cut).trim();
      if (!piece) continue;
      if (batch.length && (batch.length >= BATCH_SIZE || chars + piece.length > BATCH_CHARS)) {
        batches.push({ start, end, turns: batch });
        batch = [];
        chars = 0;
      }
      if (batch.length === 0) start = index;
      batch.push({ ...turn, text: piece });
      chars += piece.length;
      end = index;
    }
  });
  if (batch.length) batches.push({ start, end, turns: batch });
  return batches;
}

// A Gemini conversation can contain up to two catalog speakers. Designed
// voice IDs cannot be mixed in that mode, so those stay single-speaker.
export function makeSpeechGroups(turns) {
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

export function retryHintMs(message) {
  const hint = message.match(/retry\s+in\s+([\d.a-z\s]+)/i)?.[1]?.split(/\s+or\b/i)[0]?.trim();
  if (!hint) return null;
  const units = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, second: 1000, seconds: 1000, m: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000 };
  const parts = [...hint.matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?|ms|[smhd])/gi)];
  if (!parts.length || parts.map((part) => part[0].replace(/\s+/g, "")).join("") !== hint.replace(/\s+/g, "")) return null;
  return parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2].toLowerCase()], 0);
}
