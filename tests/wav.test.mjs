import test from "node:test";
import assert from "node:assert/strict";
import { joinWavClips } from "../lib/client/audioBlob.js";
import { buildWavHeader, parseWavHeader } from "../lib/shared/wav.js";

const FORMAT = { channels: 1, sampleRate: 24000, bitsPerSample: 16 };

function makeWav(samples, format = FORMAT) {
  const data = new Uint8Array(samples * 2).fill(7);
  return new Blob([buildWavHeader(format, data.length), data], { type: "audio/wav" });
}

test("a header round-trips through the parser", () => {
  const header = buildWavHeader(FORMAT, 480);
  assert.deepEqual(parseWavHeader(header), { ...FORMAT, dataOffset: 44, dataLength: 480 });
  assert.throws(() => parseWavHeader(new Uint8Array(50)), /WAV/);
});

test("joining clips keeps all audio and adds one gap between each", async () => {
  const clips = [makeWav(2400), makeWav(4800), makeWav(1200)];
  const joined = await joinWavClips(clips, 250);
  const bytes = new Uint8Array(await joined.arrayBuffer());
  const info = parseWavHeader(bytes);

  const gapBytes = 6000 * 2; // 250 ms at 24 kHz, 16-bit mono
  assert.equal(info.dataLength, (2400 + 4800 + 1200) * 2 + gapBytes * 2);
  assert.equal(bytes.length, 44 + info.dataLength);
  assert.equal(bytes[44], 7);
  assert.equal(bytes[44 + 2400 * 2], 0, "silence follows the first clip");
});

test("one clip is returned as is, mismatched formats are refused", async () => {
  const only = makeWav(100);
  assert.equal(await joinWavClips([only]), only);
  await assert.rejects(joinWavClips([makeWav(100), makeWav(100, { ...FORMAT, sampleRate: 16000 })]), /형식/);
});
