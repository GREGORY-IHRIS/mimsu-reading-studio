import test from "node:test";
import assert from "node:assert/strict";
import { splitText } from "../lib/shared/textSplit.js";

test("short text is returned as one piece", () => {
  assert.deepEqual(splitText("  안녕하세요.  ", 100), ["안녕하세요."]);
});

test("prefers sentence ends and never exceeds the limit", () => {
  const text = "첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다.";
  const pieces = splitText(text, 30);
  assert.ok(pieces.every((piece) => piece.length <= 30));
  assert.ok(pieces.every((piece) => piece.endsWith("다.")));
  assert.equal(pieces.join(" "), text);
});

test("cuts at line breaks before sentence ends", () => {
  const text = `${"가".repeat(40)}\n${"나".repeat(40)}`;
  assert.deepEqual(splitText(text, 60), ["가".repeat(40), "나".repeat(40)]);
});

test("never splits inside an emotion tag", () => {
  const text = `${"가".repeat(28)} <short pause> ${"나".repeat(28)}`;
  const pieces = splitText(text, 40);
  for (const piece of pieces) {
    assert.equal((piece.match(/</g) || []).length, (piece.match(/>/g) || []).length, piece);
  }
});

test("text without any boundary is cut at the limit and loses nothing", () => {
  const text = "가".repeat(250);
  const pieces = splitText(text, 100);
  assert.deepEqual(pieces.map((piece) => piece.length), [100, 100, 50]);
});
