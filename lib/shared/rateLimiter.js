// Sliding-window limiter for Gemini's per-minute cap. Every attempt that
// reaches Gemini is recorded (refused ones count toward the cap too).
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  let stamps = [];
  return {
    // Milliseconds to wait before the next request may be sent (0 = go now).
    waitMs() {
      const t = now();
      stamps = stamps.filter((at) => t - at < windowMs);
      return stamps.length >= limit ? stamps[0] + windowMs - t : 0;
    },
    record() {
      stamps.push(now());
    },
  };
}
