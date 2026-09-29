import { CLIP_CACHE_MAX_AGE_MS, CLIP_CACHE_MAX_BYTES } from "../shared/config.js";

// Every finished Gemini call is kept in the browser (IndexedDB), addressed by
// a hash of the exact request that produced it. Retrying after a failure or
// the daily limit, or regenerating a script after editing one line, then only
// asks Gemini for the calls whose content actually changed.

const DATABASE = "mimsu-tts-clips";
const LEGACY_DATABASE = "mimsu-tts-segments"; // old per-script cache, unusable now
const STORE = "clips";

let databasePromise;

function database() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { indexedDB.deleteDatabase(LEGACY_DATABASE); } catch { /* nothing to clean up */ }
  }
  return databasePromise;
}

async function run(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function trim() {
  const records = (await run("readonly", (store) => store.getAll())) || [];
  const cutoff = Date.now() - CLIP_CACHE_MAX_AGE_MS;
  const doomed = new Set(records.filter((record) => record.at < cutoff).map((record) => record.key));
  let total = records.filter((record) => !doomed.has(record.key)).reduce((sum, record) => sum + record.size, 0);
  for (const record of records.filter((record) => !doomed.has(record.key)).sort((a, b) => a.at - b.at)) {
    if (total <= CLIP_CACHE_MAX_BYTES) break;
    doomed.add(record.key);
    total -= record.size;
  }
  if (doomed.size) await run("readwrite", (store) => { doomed.forEach((key) => store.delete(key)); });
}

// Returns null when this browser can't provide the cache (private mode, no
// IndexedDB…) — callers then simply generate without saving progress.
export function openClipCache() {
  if (typeof indexedDB === "undefined" || typeof crypto?.subtle === "undefined") return null;
  return {
    keyFor: sha256Hex,
    get: async (key) => (await run("readonly", (store) => store.get(key)))?.blob ?? null,
    has: async (key) => (await run("readonly", (store) => store.count(key))) > 0,
    put: async (key, blob) => {
      await run("readwrite", (store) => store.put({ key, blob, size: blob.size, at: Date.now() }));
      await trim();
    },
    stats: async () => {
      const records = (await run("readonly", (store) => store.getAll())) || [];
      return { clips: records.length, bytes: records.reduce((sum, record) => sum + record.size, 0) };
    },
    clear: () => run("readwrite", (store) => store.clear()),
  };
}
