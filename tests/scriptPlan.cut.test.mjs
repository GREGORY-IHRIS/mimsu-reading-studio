import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS_PER_CALL } from "../lib/shared/config.js";
import { PAUSE_SEPARATOR, PAUSE_STYLE, PAUSE_TAG } from "../lib/shared/wavSplit.js";
import { planCalls, planPieces, splitLongTurns, validateCall } from "../lib/shared/scriptPlan.js";

// Plans that read several lines in one call and cut the recording apart again.

const turn = (speaker, voice, text, style = "") => ({ speaker, voice, text, style });

const interleaved = (voices = 4, lines = 12, voiceName = (i) => `Voice${i}`) =>
  Array.from({ length: lines }, (_, i) => turn(`화자${i % voices}`, voiceName(i % voices), `${i}번째 대사예요.`));

const allPieces = (plan) => plan.calls.flatMap((call) => call.pieceIndices).sort((a, b) => a - b);

test("four voices trading lines are read two voices per call", () => {
  const sequence = planCalls(interleaved(), { mode: "sequence" });
  const plan = planCalls(interleaved());
  assert.equal(sequence.calls.length, 6);
  assert.equal(plan.mode, "pairs");
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.pieceCount, 12);
});

test("n voices need about n/2 calls", () => {
  for (const voices of [3, 4, 5, 6, 8, 10]) {
    const plan = planCalls(interleaved(voices, voices * 6));
    assert.equal(plan.calls.length, Math.ceil(voices / 2), `${voices} voices`);
  }
});

test("every line lands in exactly one call, and a pair call reads in script order", () => {
  const plan = planCalls(interleaved());
  assert.deepEqual(allPieces(plan), Array.from({ length: 12 }, (_, i) => i));
  for (const call of plan.calls) {
    assert.equal(validateCall(call.turns), null);
    assert.equal(call.turns.length, call.pieceIndices.length);
    assert.deepEqual(call.pieceIndices, [...call.pieceIndices].sort((a, b) => a - b));
    assert.equal(new Set(call.turns.map((t) => t.speaker)).size, 2);
    call.turns.forEach((t, i) => assert.equal(t.text.endsWith(PAUSE_TAG), i < call.turns.length - 1));
    assert.equal(call.cut.lines.length, call.pieceIndices.length);
    assert.deepEqual(call.cut.lines.map((line) => line.pieceIndex), call.pieceIndices);
    assert.deepEqual([...new Set(call.cut.lines.map((line) => line.group))].sort(), [0, 1]);
  }
});

test("the cutter is told each line's length and where its sentences end", () => {
  const plan = planCalls([
    turn("A", "Kore", "안녕하세요. 반가워요."),
    turn("B", "Puck", "네, 저도요."),
    turn("C", "Zephyr", "저는 셋째예요."),
    turn("A", "Kore", "또 저예요."),
    turn("B", "Puck", "저도요."),
    turn("C", "Zephyr", "저도요."),
  ]);
  const line = plan.calls.find((call) => call.cut).cut.lines[0];
  assert.equal(line.chars, "안녕하세요. 반가워요.".length);
  assert.deepEqual(line.ends, ["안녕하세요.".length]);
});

test("designed voices interleaved cost one call per voice", () => {
  const plan = planCalls(interleaved(4, 12, (i) => `voice_custom${i}`));
  assert.equal(plan.mode, "voices");
  assert.equal(plan.calls.length, 4);
  for (const call of plan.calls) {
    assert.equal(call.turns.length, 1);
    assert.equal(call.turns[0].text.split(PAUSE_SEPARATOR).length, call.pieceIndices.length);
    assert.equal(validateCall(call.turns), null);
  }
});

test("a designed voice is never paired with another voice", () => {
  const turns = [
    turn("A", "Kore", "첫째."), turn("B", "voice_x", "둘째."), turn("C", "Puck", "셋째."),
    turn("A", "Kore", "넷째."), turn("B", "voice_x", "다섯째."), turn("C", "Puck", "여섯째."),
  ];
  for (const call of planCalls(turns).calls) {
    const voices = new Set(call.turns.map((t) => t.voice));
    if (voices.has("voice_x")) assert.equal(voices.size, 1);
    assert.equal(validateCall(call.turns), null);
  }
});

test("voices too big to share a call are not paired", () => {
  const big = "가".repeat(Math.floor(MAX_CHARS_PER_CALL * 0.6));
  const turns = [turn("A", "Kore", big), turn("B", "Puck", big), turn("C", "Zephyr", big)];
  const plan = planCalls(turns);
  assert.ok(plan.calls.every((call) => call.chars <= MAX_CHARS_PER_CALL));
  assert.deepEqual(allPieces(plan), [0, 1, 2]);
});

test("pairing keeps every call within the size limit", () => {
  const size = (fraction) => "가".repeat(Math.floor(MAX_CHARS_PER_CALL * fraction));
  const turns = [
    turn("A", "V1", size(0.55)), turn("B", "V2", size(0.5)),
    turn("C", "V3", size(0.4)), turn("D", "V4", size(0.35)), turn("A", "V1", "끝."),
  ];
  const plan = planCalls(turns);
  assert.ok(plan.calls.every((call) => call.chars <= MAX_CHARS_PER_CALL));
  assert.deepEqual(allPieces(plan), [0, 1, 2, 3, 4]);
});

test("two names for one voice make one stream, labelled by its first name", () => {
  const turns = [
    turn("엄마", "Kore", "가."), turn("할머니", "Kore", "나."), turn("아이", "Puck", "다."),
    turn("엄마", "Kore", "라."), turn("아빠", "Zephyr", "마."), turn("아이", "Puck", "바."),
  ];
  const plan = planCalls(turns);
  const kore = plan.calls.find((call) => call.turns.some((t) => t.voice === "Kore"));
  assert.ok(kore.turns.filter((t) => t.voice === "Kore").every((t) => t.speaker === "엄마"));
  assert.ok(plan.calls.every((call) => validateCall(call.turns) === null));
});

test("a voice with two styles still gives valid calls that cover every line", () => {
  const turns = [
    turn("A", "Kore", "첫째.", "calm"), turn("B", "Puck", "둘째."), turn("A", "Kore", "셋째.", "cheerful"),
    turn("B", "Puck", "넷째."), turn("A", "Kore", "다섯째.", "calm"), turn("C", "Zephyr", "여섯째."),
    turn("D", "Charon", "일곱째."), turn("C", "Zephyr", "여덟째."),
  ];
  const plan = planCalls(turns);
  assert.ok(plan.calls.every((call) => validateCall(call.turns) === null));
  assert.deepEqual(allPieces(plan), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("lines that already contain a pause tag never use a cut plan", () => {
  const turns = interleaved();
  turns[3] = turn("화자3", "Voice3", "잠깐 <long pause> 생각했다.");
  assert.equal(planCalls(turns).mode, "sequence");
});

test("two speakers keep the in-order plan (one conversational call is enough)", () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn(`화자${i % 2}`, `Voice${i % 2}`, `${i}번째 대사예요.`));
  const plan = planCalls(turns);
  assert.equal(plan.mode, "sequence");
  assert.equal(plan.calls.length, 1);
});

test("pieces keep their position, so a later round can plan just what is missing", () => {
  const pieces = splitLongTurns(interleaved(4, 8));
  assert.deepEqual(pieces.map((piece) => piece.index), [0, 1, 2, 3, 4, 5, 6, 7]);

  const missing = [pieces[1], pieces[2], pieces[5]];
  const sequence = planPieces(missing, { mode: "sequence" });
  assert.deepEqual(sequence.calls.map((call) => call.pieceIndices), [[1, 2], [5]], "only neighbours in the script share a recording");
  assert.ok(sequence.calls.every((call) => call.cut === null));

  assert.deepEqual(allPieces(planPieces(missing)), [1, 2, 5]);
});

test("cut plans are deterministic", () => {
  const first = planCalls(interleaved(6, 30)).calls.map((call) => call.signature);
  const second = planCalls(structuredClone(interleaved(6, 30))).calls.map((call) => call.signature);
  assert.deepEqual(first, second);
});

test("every turn that must be followed by a long pause is also told to pause in words", () => {
  // The tag alone gives pauses too short and too uneven to cut at; asking for
  // the pause in the style makes them long.
  const pairs = planCalls(interleaved());
  for (const call of pairs.calls) {
    call.turns.forEach((t, i) => assert.equal(t.style.includes(PAUSE_STYLE), i < call.turns.length - 1, `turn ${i}`));
  }
  const voices = planCalls(interleaved(4, 12, (i) => `voice_custom${i}`));
  for (const call of voices.calls) {
    assert.equal(call.turns.length, 1);
    assert.ok(call.turns[0].style.includes(PAUSE_STYLE));
  }
});

test("the pause style keeps the user's own style for that turn", () => {
  const lines = ["가", "나", "다", "라", "마", "바"].map((text, i) => turn(`화자${i % 3}`, `Voice${i % 3}`, `${text}가 말했다.`, i % 3 === 0 ? "다정하게" : ""));
  const plan = planCalls(lines);
  const styled = plan.calls.flatMap((call) => call.turns).filter((t) => t.style.includes("다정하게"));
  assert.ok(styled.length > 0);
  for (const t of styled) assert.ok(t.style.startsWith("다정하게"));
});
