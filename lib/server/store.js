import crypto from "crypto";
import { DEFAULT_CAST } from "../shared/voices.js";
import { deleteFile, findFile, readJson, usingBlob, writeFile, writeJson } from "./storage.js";

// Per-user data: cast, saved voices, and the generation history. Every key is
// derived from the signed-in user's email, so one account can never address
// another account's files.

const MAX_RECENT = 50;

export { usingBlob };

export function userKeyFor(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 20);
}

const indexKey = (email) => `users/${userKeyFor(email)}/index.json`;
const audioPrefix = (email, id) => `users/${userKeyFor(email)}/audio/${id}.`;

export async function getUserData(email) {
  const fallback = { cast: DEFAULT_CAST, history: [], folders: [], customVoices: [] };
  const data = await readJson(indexKey(email), fallback);
  return { ...fallback, ...data };
}

export function saveUserData(email, data) {
  return writeJson(indexKey(email), data);
}

async function updateUserData(email, change) {
  const data = await getUserData(email);
  await saveUserData(email, { ...data, ...change(data) });
}

// ── Audio ───────────────────────────────────────────────────────────────────

export function saveAudio(email, id, buffer, mimeType) {
  const ext = mimeType.includes("wav") ? "wav" : "audio";
  return writeFile(`${audioPrefix(email, id)}${ext}`, buffer, mimeType);
}

export function readAudio(email, id) {
  return findFile(audioPrefix(email, id));
}

const deleteAudio = (email, id) => deleteFile(audioPrefix(email, id));

// ── History & folders ───────────────────────────────────────────────────────

// Unfiled, unpinned entries are the "recent" scratch pile: only the newest
// MAX_RECENT are kept, older ones are deleted with their audio. Putting a
// recording in a folder (or starring it) keeps it for good.
const isKept = (h) => h.pinned || Boolean(h.folder);

// What the browser needs to draw the library. Folders exist on their own (an
// empty folder is fine) and are also implied by any entry that names one.
export function libraryOf(data) {
  const names = new Set([...(data.folders || []), ...data.history.map((h) => h.folder).filter(Boolean)]);
  return { history: data.history, folders: [...names].sort((a, b) => a.localeCompare(b, "ko")) };
}

async function saveHistory(email, data, history, folders = data.folders) {
  const next = { ...data, history, folders: folders || [] };
  await saveUserData(email, next);
  return libraryOf(next);
}

export async function addHistoryEntry(email, entry) {
  const data = await getUserData(email);
  const combined = [entry, ...data.history];
  const droppedIds = new Set(combined.filter((h) => !isKept(h)).slice(MAX_RECENT).map((h) => h.id));

  await Promise.all([...droppedIds].map((id) => deleteAudio(email, id)));
  return saveHistory(email, data, combined.filter((h) => !droppedIds.has(h.id)));
}

export async function deleteHistoryEntry(email, id) {
  const data = await getUserData(email);
  await deleteAudio(email, id);
  return saveHistory(email, data, data.history.filter((h) => h.id !== id));
}

export async function updateHistoryEntry(email, id, patch) {
  const data = await getUserData(email);
  return saveHistory(email, data, data.history.map((h) => (h.id === id ? { ...h, ...patch } : h)));
}

export async function createFolder(email, name) {
  const data = await getUserData(email);
  return saveHistory(email, data, data.history, [...new Set([...(data.folders || []), name])]);
}

// Renaming onto an existing name merges the two folders.
export async function renameFolder(email, from, to) {
  const data = await getUserData(email);
  const history = data.history.map((h) => (h.folder === from ? { ...h, folder: to } : h));
  const folders = [...new Set((data.folders || []).map((f) => (f === from ? to : f)))];
  return saveHistory(email, data, history, folders);
}

// Deleting a folder never deletes recordings: they go back to the unfiled pile.
export async function removeFolder(email, name) {
  const data = await getUserData(email);
  const history = data.history.map((h) => (h.folder === name ? { ...h, folder: null } : h));
  return saveHistory(email, data, history, (data.folders || []).filter((f) => f !== name));
}

// ── Cast & custom voices ────────────────────────────────────────────────────

export async function saveCast(email, cast) {
  await updateUserData(email, () => ({ cast }));
}

export async function saveCustomVoice(email, voice) {
  let customVoices;
  await updateUserData(email, (data) => {
    customVoices = [voice, ...(data.customVoices || [])];
    return { customVoices };
  });
  return customVoices;
}
