import { concatWavClipsBase64 } from "./wavClient";

export function extForMime(mimeType) {
  if (mimeType?.includes("wav")) return "wav";
  if (mimeType?.includes("mpeg") || mimeType?.includes("mp3")) return "mp3";
  return "audio";
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

// One-off, throwaway sample (voice try-outs) — not saved to the user's history.
export async function previewSpeech(payload) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, preview: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "생성에 실패했어요.");
  const blob = base64ToBlob(data.audioBase64, data.mimeType);
  return URL.createObjectURL(blob);
}

// Persists server-side under the signed-in user's own storage; returns the
// caller's full, updated history so the UI can just replace its list.
export async function generateAndSave(payload) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "생성에 실패했어요.");
  return data.history.map(withUrl);
}

// One batch of script turns, generated but not saved — caller stitches segments together.
export async function generateSegment(payload) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || (res.status === 413
      ? "이 구간의 음성 파일이 전송 한도를 넘었어요. 대사를 더 짧게 나눠주세요."
      : "생성에 실패했어요."));
    error.status = res.status;
    throw error;
  }
  return { base64: data.audioBase64, mimeType: data.mimeType };
}

// Stitches already-generated segments into one saved history entry. The
// stitching itself happens locally (see lib/wavClient.js) — only the final
// file is ever sent anywhere, and only once, instead of shipping every batch
// to the server just to get the same-or-bigger combined file back.
export async function combineAndSave(clips, turns) {
  const combined = concatWavClipsBase64(clips, 250);
  return saveFinishedAudio(combined, "audio/wav", turns);
}

// Persists a finished audio file. When Vercel Blob is configured, uploads
// straight from the browser to Blob storage (bypassing serverless function
// body limits entirely) and only asks the server to record the history
// entry afterwards. Otherwise falls back to sending the audio to /api/tts
// directly, which is fine outside Vercel since there's no function body cap.
async function saveFinishedAudio(base64, mimeType, turns) {
  const prefix = await getBlobUploadPrefix();
  if (prefix) {
    const id = crypto.randomUUID();
    const ext = mimeType.includes("wav") ? "wav" : "audio";
    try {
      const { upload } = await import("@vercel/blob/client");
      await upload(`${prefix}${id}.${ext}`, base64ToBlob(base64, mimeType), {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
        multipart: true,
      });
    } catch (error) {
      throw new Error(`완성된 음성을 Blob에 저장하지 못했어요: ${error.message}`);
    }
    return recordSavedAudio(id, mimeType, turns);
  }
  return saveAudioViaServer(base64, mimeType, turns);
}

async function getBlobUploadPrefix() {
  const res = await fetch("/api/blob-upload");
  if (!res.ok) throw new Error("Blob 업로드 설정을 확인하지 못했어요.");
  const data = await res.json();
  return data.available ? data.prefix : null;
}

// Records a history entry for audio that's already sitting in Blob storage.
async function recordSavedAudio(id, mimeType, turns) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "record", id, mimeType, turns }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "저장에 실패했어요.");
  return data.history.map(withUrl);
}

async function saveAudioViaServer(base64, mimeType, turns) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "save", audioBase64: base64, mimeType, turns }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "저장에 실패했어요.");
  return data.history.map(withUrl);
}

export function withUrl(entry) {
  return { ...entry, url: `/api/audio/${entry.id}`, ext: extForMime(entry.mimeType) };
}

export async function patchHistoryEntry(id, patch) {
  const res = await fetch(`/api/history/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "저장에 실패했어요.");
  return data.history.map(withUrl);
}

export async function deleteHistoryEntry(id) {
  const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "삭제에 실패했어요.");
  return data.history.map(withUrl);
}
