// Minimal WAV (PCM) parsing/concatenation. Gemini TTS's native "conversational"
// multi-speaker mode caps out at 2 speakers per call (undocumented, found by
// testing — 3+ speakers returns a generic 400 "Invalid input received."), so
// scenes with a narrator + multiple characters are built by generating each
// line separately (single voice per call) and stitching the WAV files here.

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV 형식이 아니에요.");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") fmt = body;
    if (id === "data") data = body;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("WAV 청크를 찾지 못했어요.");
  return {
    channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    bitsPerSample: fmt.readUInt16LE(14),
    data,
  };
}

function buildWavHeader({ channels, sampleRate, bitsPerSample }, dataLength) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export function concatWavBuffers(buffers, gapMs = 250) {
  const parsed = buffers.map(parseWav);
  const format = parsed[0];
  const bytesPerMs = (format.sampleRate * format.channels * (format.bitsPerSample / 8)) / 1000;
  const gap = Buffer.alloc(Math.round(bytesPerMs * gapMs));

  const parts = [];
  parsed.forEach((p, i) => {
    parts.push(p.data);
    if (i < parsed.length - 1) parts.push(gap);
  });

  const dataBuf = Buffer.concat(parts);
  const header = buildWavHeader(format, dataBuf.length);
  return Buffer.concat([header, dataBuf]);
}
