import test from "node:test";
import assert from "node:assert/strict";
import { produceScript } from "../lib/client/produceScript.js";
import { planCalls, splitLongTurns } from "../lib/shared/scriptPlan.js";
import { buildTtsRequest } from "../lib/shared/ttsRequest.js";
import { synthesize, textsOfRequest, toneFor, wavFromPcm } from "../scripts/synth-speech.mjs";
import { expectedListening, listen } from "./helpers/listen.mjs";

// The whole reading pipeline on synthetic speech: plan → (fake) Gemini → cut →
// re-assemble. Every line has its own pitch, so the result can be checked for
// order, completeness and clean cuts.

const turn = (speaker, voice, text) => ({ speaker, voice, text, style: "" });

const SENTENCES = [
  "오늘은 날씨가 참 좋네요.", "저는 아메리카노요.", "그러게요.", "정말 맛있네요, 서연이 말이 맞았어요.",
  "다음 주에도 올까?", "언제든 오세요.", "문은 늘 열려 있으니까.", "비가 와서 그런지 손님이 별로 없네요.",
];

function makeScript(voices, lines, seed) {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const turns = [];
  for (let i = 0; i < lines; i++) {
    const count = 1 + Math.floor(random() * 3);
    const body = Array.from({ length: count }, () => SENTENCES[Math.floor(random() * SENTENCES.length)]).join(" ");
    // Neighbouring lines get different pitches, so the analysis below can tell them apart.
    let text = `${i + 1}번 ${body}`;
    while (turns.length && toneFor(text) === toneFor(turns.at(-1).text)) text += " 네.";
    const who = voices === 2 ? i % 2 : Math.floor(random() * voices);
    turns.push(turn(`화자${who}`, `Voice${who}`, text));
  }
  return { turns, random };
}

// A fake Gemini: answers a call with synthetic speech built from its request.
function fakeGemini({ weakShare = 0, random = Math.random } = {}) {
  const rounds = [];
  const runRound = async (plan, fresh, onClip) => {
    rounds.push(plan);
    for (const call of plan.calls) {
      const texts = textsOfRequest(buildTtsRequest(call.turns));
      const pcm = synthesize(texts, { pause: () => (random() < weakShare ? 0.3 : 1.2 + random() * 0.5) });
      const clip = new Blob([wavFromPcm(pcm)], { type: "audio/wav" });
      if ((await onClip(clip, call)) === "stop") break;
    }
  };
  return { rounds, runRound };
}

async function assertCleanResult(turns, audio, label = "") {
  const heard = await listen(audio);
  const expected = expectedListening(turns);
  assert.equal(heard.length, expected.length, `${label} one stretch of speech per line, in script order`);
  heard.forEach((run, i) => {
    assert.ok(Math.abs(run.frequency - expected[i].frequency) < 15, `line ${i + 1} pitch ${run.frequency} vs ${expected[i].frequency}`);
    assert.ok(Math.abs(run.seconds - expected[i].seconds) < 0.6, `line ${i + 1} lasts ${run.seconds}s, expected ${expected[i].seconds}s`);
  });
}

test("six voices trading 24 lines come out complete and in order from a handful of calls", async () => {
  const { turns, random } = makeScript(6, 24, 11);
  const gemini = fakeGemini({ random });
  const { audio, summary } = await produceScript({ pieces: splitLongTurns(turns), runRound: gemini.runRound });
  await assertCleanResult(turns, audio);
  const inOrder = planCalls(turns, { mode: "sequence" }).calls.length;
  assert.ok(summary.calls < inOrder, `${summary.calls} calls instead of ${inOrder}`);
  assert.ok(summary.calls <= 6, `${summary.calls} calls`);
});

test("weak pauses are never guessed: the result is still perfect, just needs another round", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { turns, random } = makeScript(5, 30, seed);
    const gemini = fakeGemini({ weakShare: 0.25, random });
    const { audio } = await produceScript({ pieces: splitLongTurns(turns), runRound: gemini.runRound });
    await assertCleanResult(turns, audio, `seed ${seed}`);
  }
});

test("when the model ignores the pause tag altogether, plain order still finishes the job", async () => {
  const { turns, random } = makeScript(6, 24, 5);
  const gemini = fakeGemini({ weakShare: 1, random });
  const { audio, summary } = await produceScript({ pieces: splitLongTurns(turns), runRound: gemini.runRound });
  await assertCleanResult(turns, audio);
  assert.equal(summary.fellBackToSequence, true);
});

test("two voices are read in plain order, in one call", async () => {
  const { turns, random } = makeScript(2, 12, 9);
  const gemini = fakeGemini({ random });
  const { audio, summary } = await produceScript({ pieces: splitLongTurns(turns), runRound: gemini.runRound });
  await assertCleanResult(turns, audio);
  assert.equal(summary.calls, 1);
});
