import crypto from "crypto";
import { GEMINI_TIMEOUT_MS } from "../shared/config.js";
import { classifyGeminiFailure } from "../shared/geminiErrors.js";
import { recordUsage } from "./usageLog.js";

// The single gateway to the Gemini API. Every request the app sends goes
// through callGemini(), which times it, classifies the outcome and writes one
// entry to the usage ledger — so nothing can spend quota without a trace.

// GEMINI_API_BASE exists so tests can point the app at scripts/mock-gemini.mjs.
const API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const MAX_LOGGED_MESSAGE = 300;

export class GeminiError extends Error {
  constructor(message, { status = 0, code, retryAfterMs = null, usage = null }) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.usage = usage;
  }
}

// The audio in a Gemini response: documented shape first (steps[] →
// model_output → content[] → audio), then a search for any audio-looking
// {data, mime_type} pair in case this very new API shifts shape.
export function extractAudio(json) {
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  for (const step of steps.filter((s) => s?.type === "model_output").reverse()) {
    const content = Array.isArray(step?.content) ? step.content : [];
    const part = content.find((c) => c?.type === "audio" && c?.data);
    if (part) return { base64: part.data, mimeType: part.mime_type || part.mimeType || "audio/wav" };
  }

  let found = null;
  (function walk(node) {
    if (found || !node || typeof node !== "object") return;
    if (typeof node.data === "string" && node.data.length > 100) {
      const mimeType = node.mime_type || node.mimeType;
      if (!mimeType || String(mimeType).startsWith("audio/")) {
        found = { base64: node.data, mimeType: mimeType || "audio/wav" };
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (found) return;
      if (value && typeof value === "object") walk(value);
    }
  })(json);
  return found;
}

// path    – e.g. "/interactions" (appended to the API base)
// context – what the ledger records: { bucket, purpose, model, user, chars, lines, speakers, job }
//           bucket "tts" counts toward the daily limit; "text" and "meta" are tracked separately.
// inspect – optional (json) => ({ error, extra }); return `error` when a 200
//           response is unusable (the call still cost quota and is logged as such)
export async function callGemini({ path, method = "POST", body, apiKey, context, inspect }) {
  const started = Date.now();
  let res = null;
  let json = null;
  let failure = null;

  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "x-goog-api-key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    json = await res.json().catch(() => null);
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    failure = timedOut
      ? { outcome: "timeout", code: "TIMEOUT", message: "음성 생성 시간이 초과됐어요. 대사를 나눠서 다시 시도해주세요." }
      : { outcome: "network", code: "NETWORK", message: "Gemini 서버에 연결하지 못했어요." };
  }

  let extra = {};
  if (!failure && !res.ok) {
    const message = json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`;
    failure = { ...classifyGeminiFailure(res.status, message), message };
  }
  if (!failure && inspect) {
    const inspected = inspect(json) || {};
    extra = inspected.extra || {};
    if (inspected.error) failure = { outcome: "error", code: "EMPTY", message: inspected.error };
  }

  const event = {
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date(started).toISOString(),
    type: "call",
    bucket: context.bucket,
    purpose: context.purpose,
    model: context.model,
    outcome: failure ? failure.outcome : "ok",
    http: res?.status ?? 0,
    ms: Date.now() - started,
    ...context.details,
    ...extra,
    user: context.user,
    ...(failure ? { error: failure.message.slice(0, MAX_LOGGED_MESSAGE) } : {}),
  };
  // Also visible in the host's runtime logs (Vercel → Logs), one JSON line each.
  console.log(`[gemini-call] ${JSON.stringify(event)}`);
  const { usage } = await recordUsage(event);

  if (failure) {
    throw new GeminiError(failure.message, {
      status: res?.status ?? 0,
      code: failure.code,
      retryAfterMs: failure.retryAfterMs ?? null,
      usage,
    });
  }
  return { json, usage };
}
