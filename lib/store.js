import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DEFAULT_CAST = [
  { name: "나레이터", voice: "Schedar", style: "담담하게, 차분한 나레이션 톤으로" },
];
const MAX_HISTORY = 30;
const LOCAL_ROOT = path.join(process.cwd(), ".data");

function userKey(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 20);
}

function usingBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function localReadJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function localWriteJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
}

export async function getUserData(email) {
  const key = userKey(email);
  const fallback = { cast: DEFAULT_CAST, history: [], customVoices: [] };

  if (usingBlob()) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: `users/${key}/index.json`, limit: 1 });
    if (blobs.length === 0) return fallback;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    if (!res.ok) return fallback;
    const data = await res.json();
    return { ...fallback, ...data };
  }

  const data = await localReadJson(path.join(LOCAL_ROOT, key, "index.json"), fallback);
  return { ...fallback, ...data };
}

export async function saveUserData(email, data) {
  const key = userKey(email);

  if (usingBlob()) {
    const { put } = await import("@vercel/blob");
    await put(`users/${key}/index.json`, JSON.stringify(data), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }

  await localWriteJson(path.join(LOCAL_ROOT, key, "index.json"), data);
}

export async function saveAudio(email, id, buffer, mimeType) {
  const key = userKey(email);
  const ext = mimeType.includes("wav") ? "wav" : "audio";

  if (usingBlob()) {
    const { put } = await import("@vercel/blob");
    await put(`users/${key}/audio/${id}.${ext}`, buffer, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }

  const filePath = path.join(LOCAL_ROOT, key, "audio", `${id}.${ext}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

export async function readAudio(email, id) {
  const key = userKey(email);

  if (usingBlob()) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: `users/${key}/audio/${id}.`, limit: 1 });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType: res.headers.get("content-type") || "audio/wav" };
  }

  const dir = path.join(LOCAL_ROOT, key, "audio");
  try {
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.startsWith(`${id}.`));
    if (!match) return null;
    const buffer = await fs.readFile(path.join(dir, match));
    return { buffer, mimeType: match.endsWith(".wav") ? "audio/wav" : "application/octet-stream" };
  } catch {
    return null;
  }
}

async function deleteAudio(email, id) {
  const key = userKey(email);
  if (usingBlob()) {
    const { list, del } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: `users/${key}/audio/${id}.`, limit: 1 });
    if (blobs.length > 0) await del(blobs[0].url).catch(() => {});
    return;
  }
  const dir = path.join(LOCAL_ROOT, key, "audio");
  try {
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.startsWith(`${id}.`));
    if (match) await fs.unlink(path.join(dir, match));
  } catch {
    // nothing to delete
  }
}

// Pinned entries never count toward the 30-item cap or get auto-deleted —
// only unpinned entries are trimmed, oldest first, in their original order.
export async function addHistoryEntry(email, entry) {
  const data = await getUserData(email);
  const combined = [entry, ...data.history];
  const unpinned = combined.filter((h) => !h.pinned);
  const droppedIds = new Set(unpinned.slice(MAX_HISTORY).map((h) => h.id));

  await Promise.all([...droppedIds].map((id) => deleteAudio(email, id)));

  const history = combined.filter((h) => !droppedIds.has(h.id));
  await saveUserData(email, { ...data, history });
  return history;
}

export async function deleteHistoryEntry(email, id) {
  const data = await getUserData(email);
  const history = data.history.filter((h) => h.id !== id);
  await deleteAudio(email, id);
  await saveUserData(email, { ...data, history });
  return history;
}

export async function updateHistoryEntry(email, id, patch) {
  const data = await getUserData(email);
  const history = data.history.map((h) => (h.id === id ? { ...h, ...patch } : h));
  await saveUserData(email, { ...data, history });
  return history;
}

export async function saveCast(email, cast) {
  const data = await getUserData(email);
  await saveUserData(email, { ...data, cast });
}

export async function saveCustomVoice(email, voice) {
  const data = await getUserData(email);
  const customVoices = [voice, ...(data.customVoices || [])];
  await saveUserData(email, { ...data, customVoices });
  return customVoices;
}
