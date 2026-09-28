const DATABASE_NAME = "mimsu-tts-segments";
const STORE_NAME = "clips";
let databasePromise;

function database() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

async function read(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clear() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// One resumable script at a time. Changing text, cast, or delivery settings
// clears obsolete clips so the browser never accumulates old WAV files.
export async function prepareSegmentCache(jobKey) {
  if (typeof indexedDB === "undefined") return null;
  const previous = await read("job");
  if (previous !== jobKey) {
    await clear();
    await write("job", jobKey);
  }
  return segmentCache(jobKey);
}

// Reuse completed audio from the previous batching layout without clearing it.
export async function loadSegmentCache(jobKey) {
  if (typeof indexedDB === "undefined" || (await read("job")) !== jobKey) return null;
  return segmentCache(jobKey);
}

function segmentCache(jobKey) {
  return {
    get: async (index) => (await read("job")) === jobKey ? read(`clip:${index}`) : null,
    put: async (index, base64) => {
      if ((await read("job")) !== jobKey) throw new Error("다른 대본의 임시 저장이 시작됐어요.");
      await write(`clip:${index}`, base64);
    },
    clear: async () => { if ((await read("job")) === jobKey) await clear(); },
  };
}
