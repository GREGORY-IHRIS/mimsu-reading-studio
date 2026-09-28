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
