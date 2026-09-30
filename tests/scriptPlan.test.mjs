import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS_PER_CALL, MAX_TURNS_PER_CALL } from "../lib/shared/config.js";
import { PAUSE_SEPARATOR } from "../lib/shared/wavSplit.js";
import { makeSpeechGroups, planCalls, splitIntoRuns, validateCall } from "../lib/shared/scriptPlan.js";

const turn = (speaker, voice, text, style = "") => ({ speaker, voice, text, style });
const speakersOf = (groups) => groups.map((group) => group.map((item) => item.speaker));

test("two catalog speakers share one call while a third starts another", () => {
  const groups = makeSpeechGroups([
    turn("나레이터", "Kore", "처음"),
    turn("서연", "Puck", "안녕"),
    turn("나레이터", "Kore", "다음"),
    turn("지훈", "Schedar", "반가워"),
  ]);
  assert.deepEqual(speakersOf(groups), [["나레이터", "서연", "나레이터"], ["지훈"]]);
});

test("designed voices stay separate from other speakers", () => {
  const groups = makeSpeechGroups([turn("엄마", "voice_custom", "안녕"), turn("아이", "Puck", "안녕하세요")]);
  assert.equal(groups.length, 2);
});

test("different styles on one speaker can join a later two-speaker conversation", () => {
  const groups = makeSpeechGroups([
    turn("엄마", "Kore", "첫 줄", "calm"),
    turn("엄마", "Kore", "둘째 줄", "cheerful"),
    turn("아이", "Puck", "셋째 줄", "curious"),
  ]);
  assert.equal(groups.length, 1);
});

test("one speaker with two styles cannot share a call", () => {
  const groups = makeSpeechGroups([turn("엄마", "Kore", "가", "calm"), turn("엄마", "Kore", "나", "cheerful")]);
  assert.equal(groups.length, 2);
});

test("many short two-speaker turns fit in one call", () => {
  const turns = Array.from({ length: MAX_TURNS_PER_CALL }, (_, i) => turn(`화자${i % 2}`, `Voice${i % 2}`, "가".repeat(10)));
  const { calls } = planCalls(turns);
  assert.equal(calls.length, 1);
});

test("long scripts keep every character and respect the per-call limits", () => {
  const turns = Array.from({ length: 60 }, (_, i) =>
    turn(`화자${i % 4}`, `Voice${i % 4}`, "가".repeat(i < 20 ? 134 : 133))
  );
  const { calls, chars } = planCalls(turns, { mode: "sequence" });
  assert.equal(chars, 8000);
  assert.ok(calls.every((call) => call.chars <= MAX_CHARS_PER_CALL));
  assert.ok(calls.every((call) => call.turns.length <= MAX_TURNS_PER_CALL));
  // Four speakers rotating: a call can hold only two of them, whatever the size limit.
  assert.equal(calls.length, 30);
});

test("a short four-speaker scene needs one call per speaker pair, not per line", () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn(`화자${i % 4}`, `Voice${i % 4}`, "가".repeat(80)));
  assert.equal(planCalls(turns).calls.length, 4);
});

test("a very long single turn is split, never dropped", () => {
  const text = "이것은 긴 문장입니다. ".repeat(Math.ceil((MAX_CHARS_PER_CALL * 3.5) / 12));
  const { calls } = planCalls([turn("나레이터", "Kore", text)]);
  assert.ok(calls.length >= 4);
  assert.ok(calls.every((call) => call.chars <= MAX_CHARS_PER_CALL));
  assert.equal(calls.map((call) => call.turns.map((t) => t.text).join(" ")).join(" ").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
});

test("the same content always produces the same cache signatures", () => {
  const turns = [turn("A", "Kore", "안녕하세요."), turn("B", "Puck", "반가워요.")];
  const first = planCalls(turns).calls.map((call) => call.signature);
  const second = planCalls(structuredClone(turns)).calls.map((call) => call.signature);
  assert.deepEqual(first, second);
  const edited = planCalls([turn("A", "Kore", "안녕하세요!"), turn("B", "Puck", "반가워요.")]).calls;
  assert.notEqual(edited[0].signature, first[0]);
});

test("editing the end of a script leaves earlier calls' signatures untouched", () => {
  const original = Array.from({ length: 12 }, (_, i) => turn(`화자${i % 3}`, `Voice${i % 3}`, `${i}번째 대사입니다.`.repeat(20)));
  const edited = original.map((t, i) => (i === 11 ? { ...t, text: "바뀐 마지막 대사" } : t));
  const before = planCalls(original).calls.map((call) => call.signature);
  const after = planCalls(edited).calls.map((call) => call.signature);
  assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
  assert.notEqual(after.at(-1), before.at(-1));
});

test("renaming a single-voice speaker does not change the request", () => {
  const a = planCalls([turn("나레이터", "Kore", "같은 문장")]).calls[0].signature;
  const b = planCalls([turn("낭독", "Kore", "같은 문장")]).calls[0].signature;
  assert.equal(a, b);
});

test("validateCall rejects what one Gemini call cannot carry", () => {
  assert.equal(validateCall([turn("A", "Kore", "안녕")]), null);
  assert.equal(validateCall([turn("A", "Kore", "가".repeat(MAX_CHARS_PER_CALL + 1))]) !== null, true);
  assert.equal(validateCall([turn("A", "Kore", "가"), turn("B", "Puck", "나"), turn("C", "Zephyr", "다")]) !== null, true);
  assert.equal(validateCall([turn("A", "voice_x", "가"), turn("B", "Puck", "나")]) !== null, true);
  assert.equal(validateCall([turn("A", "Kore", "가"), turn("A", "Puck", "나")]) !== null, true);
  assert.equal(validateCall([]) !== null, true);
});

test("splitIntoRuns merges neighbours with the same speaker and style", () => {
  const runs = splitIntoRuns([
    turn("A", "Kore", "1"), turn("A", "Kore", "2"), turn("B", "Puck", "3"), turn("A", "Kore", "4"),
  ]);
  assert.deepEqual(runs.map((run) => run.map((t) => t.text)), [["1", "2"], ["3"], ["4"]]);
});

// ── per-voice plan ──────────────────────────────────────────────────────────

const interleaved = () => Array.from({ length: 12 }, (_, i) => turn(`화자${i % 4}`, `Voice${i % 4}`, `${i}번째 대사예요.`));

test("four voices trading lines cost one call per voice, not one per change", () => {
  const seq = planCalls(interleaved(), { mode: "sequence" });
  const plan = planCalls(interleaved());
  assert.equal(seq.calls.length, 6);
  assert.equal(plan.mode, "voices");
  assert.equal(plan.calls.length, 4);
  assert.equal(plan.pieceCount, 12);
});

test("every line lands in exactly one per-voice call, in order within its voice", () => {
  const plan = planCalls(interleaved());
  const all = plan.calls.flatMap((call) => call.pieceIndices).sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 12 }, (_, i) => i));
  for (const call of plan.calls) {
    assert.equal(call.turns.length, 1);
    assert.equal(call.turns[0].text.split(PAUSE_SEPARATOR).length, call.pieceIndices.length);
    assert.deepEqual(call.pieceIndices, [...call.pieceIndices].sort((a, b) => a - b));
    assert.equal(validateCall(call.turns), null);
  }
});

test("two speakers keep the in-order plan (one conversational call is cheaper or equal)", () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn(`화자${i % 2}`, `Voice${i % 2}`, `${i}번째 대사예요.`));
  const plan = planCalls(turns);
  assert.equal(plan.mode, "sequence");
  assert.equal(plan.calls.length, 1);
});

test("lines that already contain a pause tag never use the per-voice plan", () => {
  const turns = interleaved();
  turns[3] = turn("화자3", "Voice3", "잠깐 <long pause> 생각했다.");
  assert.equal(planCalls(turns).mode, "sequence");
});

test("a voice with different styles is planned as separate streams", () => {
  const turns = interleaved().map((t, i) => ({ ...t, style: i < 6 ? "차분하게" : "밝게" }));
  const plan = planCalls(turns);
  assert.ok(plan.calls.every((call) => new Set(call.turns.map((t) => t.style)).size === 1));
});
