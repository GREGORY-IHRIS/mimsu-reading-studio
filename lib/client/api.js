import { base64ToBlob, blobToBase64 } from "./audioBlob.js";

// Thin wrappers around the app's own /api routes, so components never build
// fetch calls or parse error bodies themselves.

export class ApiError extends Error {
  // code: QUOTA_DAILY | RATE_LIMIT | REJECTED | AUTH | UPSTREAM | NETWORK | …
  constructor(message, { status = 0, code = "UNKNOWN", retryAfterMs = null, usage = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.usage = usage;
  }
}

async function request(path, { method = "GET", body, fallbackMessage = "요청에 실패했어요." } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("서버에 연결하지 못했어요. 인터넷 연결을 확인해주세요.", { code: "NETWORK" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const tooLarge = res.status === 413 ? "음성 파일이 전송 한도를 넘었어요." : null;
    throw new ApiError(data.error || tooLarge || fallbackMessage, {
      status: res.status,
      code: data.code || "UNKNOWN",
      retryAfterMs: data.retryAfterMs ?? null,
      usage: data.usage ?? null,
    });
  }
  return data;
}

// ── Speech ──────────────────────────────────────────────────────────────────

// One Gemini call. `job` ({id, index, total, attempt}) only labels the entry
// in the usage log so a run of calls can be traced back to one button press.
export async function requestSpeech({ turns, purpose, job }) {
  const data = await request("/api/tts", {
    method: "POST",
    body: { mode: "speech", turns, purpose, job },
    fallbackMessage: "음성 생성에 실패했어요.",
  });
  return { clip: base64ToBlob(data.audioBase64, "audio/wav"), usage: data.usage ?? null };
}

// Throwaway sample (voice try-outs): not saved to history.
export async function previewSpeech({ text, voice, style }) {
  const turns = [{ speaker: "미리듣기", voice, style: style || "", text }];
  const { clip } = await requestSpeech({ turns, purpose: "preview" });
  return URL.createObjectURL(clip);
}

// ── History & saving ────────────────────────────────────────────────────────

export function extForMime(mimeType) {
  if (mimeType?.includes("wav")) return "wav";
  if (mimeType?.includes("mpeg") || mimeType?.includes("mp3")) return "mp3";
  return "audio";
}

export function withUrl(entry) {
  return { ...entry, url: `/api/audio/${entry.id}`, ext: extForMime(entry.mimeType) };
}

// The library is the history plus the folder names (a folder may be empty).
const toLibrary = (data) => ({ history: data.history.map(withUrl), folders: data.folders || [] });

// Persists a finished audio Blob and returns the caller's updated library.
// With Vercel Blob configured the browser uploads straight to Blob storage
// (no function body limit) and the server only records the history entry.
// Otherwise (local development) the audio is sent to /api/tts directly.
export async function saveFinishedAudio(blob, entry) {
  const mimeType = blob.type || "audio/wav";
  const { available, prefix } = await request("/api/blob-upload", {
    fallbackMessage: "Blob 업로드 설정을 확인하지 못했어요.",
  });

  if (!available) {
    const audioBase64 = await blobToBase64(blob);
    return toLibrary(await request("/api/tts", {
      method: "POST",
      body: { mode: "save", audioBase64, mimeType, entry },
      fallbackMessage: "저장에 실패했어요.",
    }));
  }

  const id = crypto.randomUUID();
  try {
    const { upload } = await import("@vercel/blob/client");
    await upload(`${prefix}${id}.${mimeType.includes("wav") ? "wav" : "audio"}`, blob, {
      access: "public",
      handleUploadUrl: "/api/blob-upload",
      multipart: true,
    });
  } catch (error) {
    throw new Error(`완성된 음성을 Blob에 저장하지 못했어요: ${error.message}`);
  }
  return toLibrary(await request("/api/tts", {
    method: "POST",
    body: { mode: "record", id, mimeType, entry },
    fallbackMessage: "저장에 실패했어요.",
  }));
}

export async function fetchLibrary() {
  return toLibrary(await request("/api/history", { fallbackMessage: "보관함을 불러오지 못했어요." }));
}

export async function patchHistoryEntry(id, patch) {
  return toLibrary(await request(`/api/history/${id}`, {
    method: "PATCH", body: patch, fallbackMessage: "저장에 실패했어요.",
  }));
}

export async function deleteHistoryEntry(id) {
  return toLibrary(await request(`/api/history/${id}`, {
    method: "DELETE", fallbackMessage: "삭제에 실패했어요.",
  }));
}

// ── Folders ─────────────────────────────────────────────────────────────────

const folderRequest = (method, body) =>
  request("/api/folders", { method, body, fallbackMessage: "폴더를 바꾸지 못했어요." }).then(toLibrary);

export const createFolder = (name) => folderRequest("POST", { name });
export const renameFolder = (from, to) => folderRequest("PATCH", { from, to });
export const removeFolder = (name) => folderRequest("DELETE", { name });

// ── Script tools ────────────────────────────────────────────────────────────

export async function formatScript(text, castNames) {
  const data = await request("/api/script/format", {
    method: "POST", body: { text, castNames }, fallbackMessage: "정리에 실패했어요.",
  });
  return data.text;
}

// ── Usage ledger ────────────────────────────────────────────────────────────

export function fetchUsage({ days = 14 } = {}) {
  return request(`/api/usage?days=${days}`, { fallbackMessage: "사용량을 불러오지 못했어요." });
}

// Manual correction, e.g. when calls were also made from outside this app.
export function adjustUsage(used) {
  return request("/api/usage", {
    method: "POST", body: { used }, fallbackMessage: "사용량을 고치지 못했어요.",
  });
}
