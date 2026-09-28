import test from "node:test";
import assert from "node:assert/strict";
import { BATCH_CHARS, BATCH_SIZE, REQUESTS_PER_WINDOW, makeBatches, makeSpeechGroups, requestCapacity, retryHintMs } from "../lib/scriptBatches.js";

const turn = (speaker, voice, text, style = "") => ({ speaker, voice, text, style });

test("two catalog speakers share one request while a third starts another", () => {
  const groups = makeSpeechGroups([
    turn("나레이터", "Kore", "처음"),
    turn("서연", "Puck", "안녕"),
    turn("나레이터", "Kore", "다음"),
    turn("지훈", "Schedar", "반가워"),
  ]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.speaker)), [
    ["나레이터", "서연", "나레이터"], ["지훈"],
  ]);
});

test("designed voices stay separate from other speakers", () => {
  const groups = makeSpeechGroups([
    turn("엄마", "voice_custom", "안녕"),
    turn("아이", "Puck", "안녕하세요"),
  ]);
  assert.equal(groups.length, 2);
});

test("long scripts retain all text and use fewer requests than lines", () => {
  const turns = Array.from({ length: 60 }, (_, i) =>
    turn(`화자${i % 4}`, `Voice${i % 4}`, "가".repeat(i < 20 ? 134 : 133))
  );
  const batches = makeBatches(turns);
  const generated = batches.flatMap((batch) => batch.turns);
  assert.equal(generated.reduce((sum, item) => sum + item.text.length, 0), 8000);
  assert.ok(batches.every((batch) => batch.turns.reduce((sum, item) => sum + item.text.length, 0) <= BATCH_CHARS));
  assert.ok(batches.every((batch) => batch.turns.length <= BATCH_SIZE));
  assert.ok(batches.every((batch) => makeSpeechGroups(batch.turns).length <= REQUESTS_PER_WINDOW));
  const calls = batches.reduce((sum, batch) => sum + makeSpeechGroups(batch.turns).length, 0);
  assert.ok(calls < turns.length, `expected fewer than ${turns.length} calls, got ${calls}`);
});

test("a short four-speaker scene uses fewer requests without dropping voices", () => {
  const turns = Array.from({ length: 8 }, (_, i) =>
    turn(`화자${i % 4}`, `Voice${i % 4}`, "가".repeat(80))
  );
  const batches = makeBatches(turns);
  assert.equal(batches.length, 1);
  assert.equal(batches.reduce((sum, batch) => sum + makeSpeechGroups(batch.turns).length, 0), 4);
  const legacyBatches = makeBatches(turns, { maxTurns: 8, maxChars: 400 });
  assert.equal(legacyBatches.reduce((sum, batch) => sum + makeSpeechGroups(batch.turns).length, 0), 5);
});

test("a dense scene never asks the client to reserve more than eight requests", () => {
  const turns = Array.from({ length: 20 }, (_, i) =>
    turn(`화자${i}`, `Voice${i}`, "가".repeat(10))
  );
  const batches = makeBatches(turns);
  assert.deepEqual(batches.map((batch) => makeSpeechGroups(batch.turns).length), [8, 2]);
});

test("minute window and Gemini retry hints remain usable", () => {
  assert.equal(requestCapacity(Array(8).fill(0), 1, 30_000).waitMs, 32_000);
  assert.equal(retryHintMs("Please retry in 10h37m25s"), 38_245_000);
});
