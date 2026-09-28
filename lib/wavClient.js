// Browser-side mirror of lib/wav.js's concatWavBuffers(). Long scripts are
// generated in small batches (see ScriptStudio.js) and used to be stitched
// back together by shipping every batch's audio to the server and getting
// the combined result back — but Vercel functions cap request/response
// bodies at 4.5MB, which a several-minute WAV blows past easily. Since
// concatenation is just splicing PCM bytes, the browser can do it itself and
// only the final file ever needs to leave the client (see lib/audio.js).

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function readAscii(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("WAV 형식이 아니에요.");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") fmt = body;
    if (id === "data") data = body;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("WAV 청크를 찾지 못했어요.");
  const fmtView = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  return {
    channels: fmtView.getUint16(2, true),
    sampleRate: fmtView.getUint32(4, true),
    bitsPerSample: fmtView.getUint16(14, true),
    data,
  };
}

function buildWavHeader({ channels, sampleRate, bitsPerSample }, dataLength) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);
  return header;
}

// Takes base64-encoded WAV clips (as returned by /api/tts) and returns one
// combined base64 WAV, with `gapMs` of silence spliced between clips.
export function concatWavClipsBase64(base64Clips, gapMs = 250) {
  const parsed = base64Clips.map((b64) => parseWav(base64ToBytes(b64)));
  const format = parsed[0];
  const bytesPerMs = (format.sampleRate * format.channels * (format.bitsPerSample / 8)) / 1000;
  const gap = new Uint8Array(Math.round(bytesPerMs * gapMs));

  let totalLength = 0;
  parsed.forEach((p, i) => {
    totalLength += p.data.length;
    if (i < parsed.length - 1) totalLength += gap.length;
  });

  const dataBuf = new Uint8Array(totalLength);
  let offset = 0;
  parsed.forEach((p, i) => {
    dataBuf.set(p.data, offset);
    offset += p.data.length;
    if (i < parsed.length - 1) {
      dataBuf.set(gap, offset);
      offset += gap.length;
    }
  });

  const header = buildWavHeader(format, dataBuf.length);
  const combined = new Uint8Array(header.length + dataBuf.length);
  combined.set(header, 0);
  combined.set(dataBuf, header.length);
  return bytesToBase64(combined);
}
