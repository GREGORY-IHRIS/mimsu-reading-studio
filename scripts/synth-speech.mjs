// Fake "speech" for the mock Gemini server and the tests: not words, but a tone
// per line with the timing of real speech — about 0.12 s per character,
// 0.5 s of silence after a sentence, and a longer pause wherever the request
// holds the <long pause> tag. Every line gets its own pitch (see toneFor), so a
// test can tell afterwards which line a piece of audio came from.

export const SAMPLE_RATE = 24000;
const SECONDS_PER_CHAR = 0.12;
const SENTENCE_PAUSE_S = 0.5;
const TAG = /<\s*long\s+pause\s*>/gi;
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s+\S)/g;

// One of 25 pitches, 150 … 870 Hz in steps of 30, from the line's words only.
export function toneFor(text) {
  let hash = 0;
  for (const ch of text.trim()) hash = (hash * 31 + ch.codePointAt(0)) % 7919;
  return 150 + 30 * (hash % 25);
}

function tone(seconds, frequency) {
  const samples = new Int16Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * 9000);
  return samples;
}

const quiet = (seconds) => new Int16Array(Math.round(seconds * SAMPLE_RATE));

// One line: speech with a short silence after each sentence.
function sayLine(text) {
  const frequency = toneFor(text);
  const parts = [];
  let from = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    parts.push(tone((end - from) * SECONDS_PER_CHAR, frequency), quiet(SENTENCE_PAUSE_S));
    from = end;
  }
  parts.push(tone(Math.max(1, text.length - from) * SECONDS_PER_CHAR, frequency));
  return concat(parts);
}

function concat(parts) {
  const all = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.length; }
  return all;
}

// `texts`: what each content item of the request says, in order. Everything
// before a <long pause> tag is one line; `pause(n)` is the length of the
// n-th tag pause (seconds); `turnGap` separates items that were not tagged.
export function synthesize(texts, { pause = () => 1.3, turnGap = 0.35 } = {}) {
  const parts = [quiet(0.15)];
  let tags = 0;
  texts.forEach((text, i) => {
    const lines = text.split(TAG);
    lines.forEach((line, n) => {
      if (line.trim()) parts.push(sayLine(line.trim()));
      if (n < lines.length - 1) parts.push(quiet(pause(tags++)));
    });
    // Turns that do not end with a tag still leave a natural gap.
    if (i < texts.length - 1 && lines.at(-1).trim()) parts.push(quiet(turnGap));
  });
  parts.push(quiet(0.2));
  return concat(parts);
}

export function wavFromPcm(pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// The texts of a Gemini "interactions" TTS request body, in reading order.
export function textsOfRequest(body) {
  const content = body.input?.[0]?.content ?? [];
  return content.flatMap((part) => (part.text ? part.text.split("\n\n") : []));
}
