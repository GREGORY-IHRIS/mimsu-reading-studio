// Every limit and tunable number in one place, with the reason it exists.
// Both the browser and the server import this file, so the client's plan and
// the server's validation can never drift apart.

export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TEXT_MODEL = "gemini-3.8-flash";

// ── Gemini quota ────────────────────────────────────────────────────────────
// The free tier allows 100 requests per day per project. Google resets the
// daily counter at midnight Pacific Time (16:00 or 17:00 in Korea). The server
// can override the limit with GEMINI_DAILY_LIMIT (e.g. after moving to a paid
// tier).
export const DEFAULT_DAILY_CALL_LIMIT = 100;
export const QUOTA_TIMEZONE = "America/Los_Angeles";
// Free tier is 10 requests/minute; stay a little below it.
export const RATE_LIMIT_CALLS = 8;
export const RATE_WINDOW_MS = 62_000;

// ── What fits into ONE Gemini call ──────────────────────────────────────────
// The daily quota counts calls, not characters, so packing as much as is safe
// into each call is what stretches the quota. Measured against the real API
// (2026-09-30, gemini-3.8-flash-tts, Korean):
//  - Characters: 980 → 140 s of audio in 42 s; 1961 → 289 s in 43 s; 3923 →
//    550 s in 46 s. Audio length per character stayed the same (no cut-off) and
//    generation is faster than real time, so 4000 is well inside the timeout.
//  - Turns: 120 turns (3262 chars, 2 speakers) worked too.
//  - Speakers: conversational mode accepts at most 2 speakers per call (3
//    answered HTTP 400 "Invalid input received"). If Google ever lifts that,
//    raising this one number is all the planner needs.
//  - 4000 is a safety margin, not a proven Google limit: a call of 9.4k
//    characters (19 minutes of audio) also came back whole in 55 s (probe,
//    2026-09-29). The margin protects browser memory (the audio travels as
//    base64 JSON), the 150 s timeout and the host's request-body limit.
//    Raising it only saves calls for scripts whose 2-voice groups are bigger
//    than this: 10 voices and 10,000 characters put about 2,000 in each pair
//    call, far below the cap.
export const MAX_CHARS_PER_CALL = 4000;
export const MAX_TURNS_PER_CALL = 120;
export const MAX_SPEAKERS_PER_CALL = 2;

// ── Whole-text limits ───────────────────────────────────────────────────────
// These are OUR limits, not Gemini's. Each call is a separate request and
// finished audio is stitched in the browser, so the length is bounded only by
// browser memory (~48 KB of WAV per second of speech) and by the daily quota.
export const MAX_TEXT_CHARS = 20_000;
// "AI 대사 구분" sends the whole text to a text model in one request and gets
// the same amount back, so it stays under the model's output limit.
export const MAX_FORMAT_CHARS = 8_000;

// ── Timing ──────────────────────────────────────────────────────────────────
export const GEMINI_TIMEOUT_MS = 150_000;
export const CLIP_GAP_MS = 250;

// ── Browser-side clip cache (see lib/client/clipCache.js) ───────────────────
export const CLIP_CACHE_MAX_BYTES = 300 * 1024 * 1024;
export const CLIP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Voices made with "내 목소리 디자인하기" have ids like "voice_…" and cannot be
// mixed with another speaker in a single call.
export function isDesignedVoice(voice) {
  return typeof voice === "string" && voice.startsWith("voice_");
}
