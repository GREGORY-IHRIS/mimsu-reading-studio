import { splitLongTurns } from "../../lib/shared/scriptPlan.js";
import { SAMPLE_RATE, toneFor } from "../../scripts/synth-speech.mjs";

// What the finished audio contains: for each pitch, in order, seconds of speech.
export async function listen(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) >> 1);
  const window = SAMPLE_RATE / 50;
  const runs = [];
  let open = null;
  for (let w = 0; w * window + window <= pcm.length; w++) {
    let energy = 0;
    let crossings = 0;
    for (let i = w * window; i < (w + 1) * window; i++) {
      energy += pcm[i] * pcm[i];
      if (i > 0 && (pcm[i] >= 0) !== (pcm[i - 1] >= 0)) crossings++;
    }
    const loud = Math.sqrt(energy / window) > 500;
    if (loud) {
      const frequency = crossings / 2 / 0.02;
      if (open) { open.windows++; open.frequencies.push(frequency); } else { open = { windows: 1, frequencies: [frequency] }; runs.push(open); }
    } else {
      open = null;
    }
  }
  const labelled = runs.map((run) => ({ seconds: run.windows * 0.02, frequency: run.frequencies.sort((a, b) => a - b)[run.frequencies.length >> 1] }));
  const merged = [];
  for (const run of labelled) {
    const last = merged.at(-1);
    if (last && Math.abs(last.frequency - run.frequency) < 15) last.seconds += run.seconds;
    else merged.push({ ...run });
  }
  return merged;
}

export const expectedListening = (turns) => splitLongTurns(turns).map((piece) => {
  let seconds = 0;
  for (const sentence of piece.text.split(/(?<=[.!?…])\s+/)) seconds += Math.max(1, sentence.length) * 0.12;
  return { frequency: toneFor(piece.text), seconds };
});

