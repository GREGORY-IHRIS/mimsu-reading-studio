import { NextResponse } from "next/server";
import { validateCall } from "../../../lib/shared/scriptPlan.js";
import { GeminiError } from "../../../lib/server/gemini.js";
import { jsonError, requireApiKey, requireSession, streamJson } from "../../../lib/server/http.js";
import { addHistoryEntry, saveAudio, userKeyFor } from "../../../lib/server/store.js";
import { synthesize } from "../../../lib/server/tts.js";

// Must be a literal for Next.js. Keep it above GEMINI_TIMEOUT_MS (150 s) in lib/shared/config.js.
export const maxDuration = 180;

const PURPOSES = new Set(["script", "single", "preview"]);
const STATUS_BY_CODE = { QUOTA_DAILY: 429, RATE_LIMIT: 429, REJECTED: 400 };

export async function POST(request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (!body) return jsonError("요청 형식이 올바르지 않아요.", 400);

  switch (body.mode) {
    case "speech": return handleSpeech(body, session);
    case "save": return handleSave(body, session);
    case "record": return handleRecord(body, session);
    default:
      return jsonError("앱이 업데이트됐어요. 페이지를 새로고침한 뒤 다시 시도해주세요.", 400, { code: "STALE_CLIENT" });
  }
}

// ── One Gemini call ─────────────────────────────────────────────────────────

function cleanJob(job) {
  if (!job || typeof job !== "object") return undefined;
  return {
    id: String(job.id || "").slice(0, 16),
    index: Number.parseInt(job.index, 10) || 0,
    total: Number.parseInt(job.total, 10) || 0,
    attempt: Number.parseInt(job.attempt, 10) || 1,
    ...(job.fallback ? { fallback: true } : {}),
  };
}

async function handleSpeech(body, session) {
  const invalid = validateCall(body.turns);
  if (invalid) return jsonError(invalid, 400, { code: "INVALID" });

  const { apiKey, response } = requireApiKey();
  if (response) return response;

  try {
    const { audio, usage } = await synthesize({
      turns: body.turns.map(({ speaker, voice, style, text }) => ({ speaker, voice, style: style || "", text })),
      apiKey,
      user: userKeyFor(session.user.email).slice(0, 8),
      purpose: PURPOSES.has(body.purpose) ? body.purpose : "script",
      job: cleanJob(body.job),
    });
    return streamJson({ audioBase64: audio.base64, mimeType: audio.mimeType, usage });
  } catch (error) {
    if (!(error instanceof GeminiError)) throw error;
    return jsonError(error.message, STATUS_BY_CODE[error.code] ?? 502, {
      code: error.code,
      retryAfterMs: error.retryAfterMs,
      usage: error.usage,
    });
  }
}

// ── Saving finished audio to the history ────────────────────────────────────

function clip(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildEntry(id, entry, mimeType) {
  return {
    id,
    label: clip(entry?.label, 80) || "음성",
    snippet: clip(entry?.snippet, 40),
    createdAt: new Date().toISOString(),
    mimeType,
    name: null,
    pinned: false,
    folder: null,
  };
}

async function saveEntry(session, id, entry, mimeType) {
  const library = await addHistoryEntry(session.user.email, buildEntry(id, entry, mimeType));
  return NextResponse.json({ entry: library.history.find((h) => h.id === id), ...library });
}

// The browser sends the finished audio itself (local development, where there
// is no Blob storage to upload to).
async function handleSave(body, session) {
  if (!body.audioBase64) return jsonError("저장할 음성 데이터가 없어요.", 400);
  const id = crypto.randomUUID();
  const mimeType = body.mimeType || "audio/wav";
  try {
    await saveAudio(session.user.email, id, Buffer.from(body.audioBase64, "base64"), mimeType);
    return await saveEntry(session, id, body.entry, mimeType);
  } catch (e) {
    return jsonError(`음성은 만들어졌지만 저장에 실패했어요: ${e.message || "알 수 없는 오류"}`, 502);
  }
}

// The audio already sits in Blob storage (uploaded straight from the
// browser); only the history entry is written here.
async function handleRecord(body, session) {
  if (!body.id) return jsonError("저장할 음성 정보가 없어요.", 400);
  try {
    return await saveEntry(session, body.id, body.entry, body.mimeType || "audio/wav");
  } catch (e) {
    return jsonError(`기록 저장에 실패했어요: ${e.message || "알 수 없는 오류"}`, 502);
  }
}
