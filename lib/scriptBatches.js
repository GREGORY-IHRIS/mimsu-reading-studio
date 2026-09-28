export const BATCH_SIZE = 4;
export const BATCH_CHARS = 600;
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

export function retryHintMs(message) {
  const hint = message.match(/retry\s+in\s+([\d.a-z\s]+)/i)?.[1]?.split(/\s+or\b/i)[0]?.trim();
  if (!hint) return null;
  const units = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, second: 1000, seconds: 1000, m: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000 };
  const parts = [...hint.matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?|ms|[smhd])/gi)];
  if (!parts.length || parts.map((part) => part[0].replace(/\s+/g, "")).join("") !== hint.replace(/\s+/g, "")) return null;
  return parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2].toLowerCase()], 0);
}
