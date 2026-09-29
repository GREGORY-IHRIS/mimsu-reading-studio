// Turns a failed Gemini HTTP response into something the rest of the app can
// act on without parsing error text again.
//
//   outcome  – what the usage log records
//   code     – what the browser switches on (sent in API error responses)

const UNITS_MS = {
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1000, second: 1000, seconds: 1000,
  m: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
};
const DURATION_PART = /(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?|ms|[smhd])/gi;

// "Please retry in 10h37m25s" → 38 245 000. Null when there is no usable hint.
export function retryHintMs(message = "") {
  const hint = message.match(/retry\s+in\s+([\d.a-z\s]+)/i)?.[1]?.split(/\s+or\b/i)[0]?.trim();
  if (!hint) return null;
  const parts = [...hint.matchAll(DURATION_PART)];
  const compact = (text) => text.replace(/\s+/g, "");
  if (!parts.length || parts.map((part) => compact(part[0])).join("") !== compact(hint)) return null;
  return parts.reduce((sum, part) => sum + Number(part[1]) * UNITS_MS[part[2].toLowerCase()], 0);
}

const FIVE_MINUTES_MS = 5 * 60_000;

export function classifyGeminiFailure(status, message = "") {
  if (status === 429) {
    const retryAfterMs = retryHintMs(message);
    const daily = /per\s*day|daily/i.test(message) || (retryAfterMs != null && retryAfterMs > FIVE_MINUTES_MS);
    return daily
      ? { outcome: "quota_exhausted", code: "QUOTA_DAILY", retryAfterMs }
      : { outcome: "rate_limited", code: "RATE_LIMIT", retryAfterMs };
  }
  if (status === 401 || status === 403) return { outcome: "rejected", code: "AUTH", retryAfterMs: null };
  if (status >= 400 && status < 500) return { outcome: "rejected", code: "REJECTED", retryAfterMs: null };
  return { outcome: "error", code: "UPSTREAM", retryAfterMs: null };
}
