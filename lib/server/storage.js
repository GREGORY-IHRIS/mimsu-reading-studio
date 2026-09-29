import fs from "fs/promises";
import path from "path";

// The only file that knows where bytes live. In production (Vercel) that is
// Vercel Blob; locally it is the ".data/" folder. Callers work with plain
// keys such as "users/<hash>/index.json" and never see the difference.

export function usingBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function localRoot() {
  return process.env.DATA_DIR || path.join(process.cwd(), ".data");
}

// Local files predate the "users/" prefix, so old ".data/<hash>/…" folders keep working.
function localPath(key) {
  return path.join(localRoot(), key.replace(/^users\//, ""));
}

// ── JSON documents ──────────────────────────────────────────────────────────

// Returns `fallback` when the document is missing or unreadable.
export async function readJson(key, fallback) {
  if (usingBlob()) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (blobs.length === 0) return fallback;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    return res.ok ? res.json() : fallback;
  }
  try {
    return JSON.parse(await fs.readFile(localPath(key), "utf-8"));
  } catch {
    return fallback;
  }
}

// Like readJson, but for documents that are rewritten often: the Blob CDN may
// serve a stale copy for up to a minute, so this reads from origin storage.
// Returns null when missing and THROWS when the read itself fails, so a
// caller never mistakes an error for an empty document and overwrites it.
export async function readJsonFresh(key) {
  if (usingBlob()) {
    const { get, BlobNotFoundError } = await import("@vercel/blob");
    let result;
    try {
      result = await get(key, { access: "public", useCache: false });
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
    if (!result || result.statusCode !== 200) return null;
    return new Response(result.stream).json();
  }
  try {
    return JSON.parse(await fs.readFile(localPath(key), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJson(key, data) {
  await writeFile(key, JSON.stringify(data), "application/json");
}

// ── Binary files (audio) ────────────────────────────────────────────────────

export async function writeFile(key, content, contentType) {
  if (usingBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, content, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  const target = localPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

// A file is looked up by "everything before the extension" because the
// extension depends on the audio type. Returns { url } (Blob), { buffer,
// mimeType } (local) or null.
export async function findFile(keyPrefix) {
  if (usingBlob()) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: keyPrefix, limit: 1 });
    return blobs.length ? { url: blobs[0].url } : null;
  }
  try {
    const target = localPath(keyPrefix);
    const file = (await fs.readdir(path.dirname(target))).find((name) => name.startsWith(path.basename(target)));
    if (!file) return null;
    return {
      buffer: await fs.readFile(path.join(path.dirname(target), file)),
      mimeType: file.endsWith(".wav") ? "audio/wav" : "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function deleteFile(keyPrefix) {
  if (usingBlob()) {
    const { list, del } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: keyPrefix, limit: 1 });
    if (blobs.length > 0) await del(blobs[0].url).catch(() => {});
    return;
  }
  try {
    const target = localPath(keyPrefix);
    const dir = path.dirname(target);
    const file = (await fs.readdir(dir)).find((name) => name.startsWith(path.basename(target)));
    if (file) await fs.unlink(path.join(dir, file));
  } catch {
    // nothing to delete
  }
}
