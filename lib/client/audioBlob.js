import { CLIP_GAP_MS } from "../shared/config.js";
import { findPauseCuts } from "../shared/wavSplit.js";
import { buildWavHeader, parseWavHeader, sameFormat, silence } from "../shared/wav.js";

// Audio is kept as Blobs in the browser: a long script is tens of MB of PCM,
// and Blobs let the browser keep that outside the JavaScript heap. Stitching
// only slices and references the clips instead of copying them.

const HEADER_PROBE_BYTES = 4096;

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64ToBlob(base64, mimeType) {
  return new Blob([base64ToBytes(base64)], { type: mimeType });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function readWavInfo(blob) {
  const probe = new Uint8Array(await blob.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
  const info = parseWavHeader(probe);
  const dataLength = info.dataLength ?? blob.size - info.dataOffset;
  return { ...info, dataLength: Math.min(dataLength, blob.size - info.dataOffset) };
}

// Joins WAV clips into one WAV Blob, with a short pause between them.
export async function joinWavClips(clips, gapMs = CLIP_GAP_MS) {
  if (clips.length === 1) return clips[0];
  const infos = [];
  for (const clip of clips) infos.push(await readWavInfo(clip));

  const format = infos[0];
  if (!infos.every((info) => sameFormat(info, format))) {
    throw new Error("구간마다 오디오 형식이 달라서 합치지 못했어요.");
  }
  const gap = silence(format, gapMs);
  const totalLength = infos.reduce((sum, info) => sum + info.dataLength, 0) + gap.length * (clips.length - 1);

  const parts = [buildWavHeader(format, totalLength)];
  clips.forEach((clip, i) => {
    parts.push(clip.slice(infos[i].dataOffset, infos[i].dataOffset + infos[i].dataLength));
    if (i < clips.length - 1) parts.push(gap);
  });
  return new Blob(parts, { type: "audio/wav" });
}

export class PauseSplitError extends Error {
  constructor(reason) {
    super(`대사 사이를 나누지 못했어요: ${reason}`);
    this.name = "PauseSplitError";
    this.code = "SPLIT_FAILED";
  }
}

// Cuts a per-voice recording back into lines (see wavSplit.js); `weights` is
// the character count of each line.
// Throws PauseSplitError when the pauses are not clear enough to trust.
export async function splitClipByPauses(clip, weights) {
  if (weights.length <= 1) return [clip];
  const info = await readWavInfo(clip);
  if (info.channels !== 1 || info.bitsPerSample !== 16) throw new PauseSplitError("지원하지 않는 오디오 형식이에요.");

  const data = new Uint8Array(await clip.slice(info.dataOffset, info.dataOffset + info.dataLength).arrayBuffer());
  const result = findPauseCuts(data, info.sampleRate, weights);
  if (!result.ok) throw new PauseSplitError(result.reason);
  return result.ranges.map(([from, to]) => new Blob([buildWavHeader(info, to - from), data.subarray(from, to)], { type: "audio/wav" }));
}
