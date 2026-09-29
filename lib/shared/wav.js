// Minimal PCM WAV helpers that work in the browser and in Node. Stitching
// clips together is just splicing PCM bytes between one new header, so the
// browser can do it without the audio ever passing through a server.

const HEADER_BYTES = 44;

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

// Reads the format and the position of the audio data from the start of a WAV
// file. `bytes` may be just the first few KB — only the header is inspected.
// `dataLength` is null when the file doesn't state it (streamed WAV).
export function parseWavHeader(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("WAV 형식이 아니에요.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    }
    if (id === "data") {
      if (!format) break;
      const streamed = size === 0 || size === 0xffffffff;
      return { ...format, dataOffset: offset + 8, dataLength: streamed ? null : size };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV 청크를 찾지 못했어요.");
}

export function sameFormat(a, b) {
  return a.channels === b.channels && a.sampleRate === b.sampleRate && a.bitsPerSample === b.bitsPerSample;
}

export function buildWavHeader({ channels, sampleRate, bitsPerSample }, dataLength) {
  const blockAlign = channels * (bitsPerSample / 8);
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);
  return header;
}

export function silence({ channels, sampleRate, bitsPerSample }, ms) {
  const frameBytes = channels * (bitsPerSample / 8);
  return new Uint8Array(Math.round((sampleRate * ms) / 1000) * frameBytes);
}
