"use client";

import { useMemo, useRef, useState } from "react";
import CastManager from "./CastManager";
import TagToolbar from "./TagToolbar";
import { parseScript, nextAvailableVoice } from "../lib/script";
import { generateAndSave } from "../lib/audio";

const MAX_CHARS = 4000;
const EXAMPLE = `밤안개가 골목 끝까지 자욱하게 내려앉았다.
지우: 누구야...? 거기 누구 있어?
그림자가 천천히 다가왔다.
민준: 나야, 놀라지 마.`;

export default function ScriptStudio({ cast, setCast, voices, onHistory }) {
  const [scriptText, setScriptText] = useState("");
  const [overrideStyle, setOverrideStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const textareaRef = useRef(null);

  const preview = useMemo(() => parseScript(scriptText, cast), [scriptText, cast]);

  async function handleAutoFormat() {
    setError("");
    setNote("");
    if (!scriptText.trim()) {
      setError("정리할 글을 먼저 입력해주세요.");
      return;
    }
    setFormatting(true);
    try {
      const res = await fetch("/api/script/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: scriptText, castNames: cast.map((c) => c.name) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "정리에 실패했어요.");
      setScriptText(data.text);
      setNote("AI가 대사와 나레이션을 구분해봤어요 — 생성 전에 한 번 훑어보고 틀린 부분은 직접 고쳐주세요.");
    } catch (e) {
      setError(e.message);
    } finally {
      setFormatting(false);
    }
  }

  async function handleGenerate() {
    setError("");
    setNote("");
    if (!scriptText.trim()) {
      setError("먼저 대본을 입력해주세요.");
      return;
    }

    const parsed = parseScript(scriptText, cast);
    if (parsed.turns.length === 0) {
      setError("읽을 대사를 찾지 못했어요.");
      return;
    }

    let workingCast = cast;
    if (parsed.unknownSpeakers.length > 0) {
      const additions = [];
      for (const name of parsed.unknownSpeakers) {
        const voice = nextAvailableVoice(voices, [...workingCast, ...additions], name);
        additions.push({ name, voice, style: "" });
      }
      workingCast = [...workingCast, ...additions];
      setCast(workingCast);
      setNote(
        `새 등장인물을 발견해서 목소리를 자동으로 배정했어요: ${additions
          .map((a) => `${a.name}(${a.voice})`)
          .join(", ")}. 마음에 안 들면 위 출연진 목록에서 바꾸고 다시 생성해주세요.`
      );
    }

    const castByName = new Map(workingCast.map((c) => [c.name.toLowerCase(), c]));
    const turns = parsed.turns.map((t) => {
      const c = castByName.get(t.speaker.toLowerCase());
      return {
        speaker: t.speaker,
        voice: c?.voice || voices[0].id,
        style: overrideStyle.trim() || c?.style || "",
        text: t.text,
      };
    });

    setLoading(true);
    try {
      const history = await generateAndSave({ mode: "multi", turns });
      onHistory(history);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const detectedSpeakers = Array.from(new Set(preview.turns.map((t) => t.speaker)));

  return (
    <>
      <CastManager cast={cast} setCast={setCast} voices={voices} />

      <div className="card">
        <label className="field-label" htmlFor="script">
          대본{" "}
          <span className="char-count">
            ({scriptText.length}/{MAX_CHARS}자)
          </span>
        </label>
        <textarea
          id="script"
          ref={textareaRef}
          value={scriptText}
          maxLength={MAX_CHARS}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder={`"이름: 대사" 형식으로 한 줄씩 적어주세요. 예:\n\n${EXAMPLE}`}
        />
        <TagToolbar textareaRef={textareaRef} value={scriptText} onChange={setScriptText} />

        <button
          type="button"
          className="chip"
          style={{ marginTop: 10 }}
          onClick={handleAutoFormat}
          disabled={formatting || !scriptText.trim()}
        >
          {formatting ? "AI가 대사를 나누는 중..." : "✨ AI로 대사·나레이션 자동 구분"}
        </button>

        <p className="hint">
          "이름: 대사"로 쓴 줄만 그 캐릭터 대사로 읽혀요. 이름 없이 그냥 쓴 줄은 전부
          나레이션으로 처리돼요. 대본 형식 없이 소설처럼 줄글로 썼다면 위 버튼으로 AI가
          대신 나눠줄 수 있어요 (100% 정확하진 않으니 결과를 확인해주세요). 처음 보는 이름이
          나오면 목소리를 자동으로 배정해드려요.
        </p>
        {detectedSpeakers.length > 0 && (
          <p className="hint">감지된 화자: {detectedSpeakers.join(", ")}</p>
        )}

        <div style={{ marginTop: 20 }}>
          <label className="field-label" htmlFor="override-style">
            이 장면 전체 톤 강제 지정 (선택 — 비워두면 각자 기본 톤 사용)
          </label>
          <input
            id="override-style"
            className="style-input"
            value={overrideStyle}
            onChange={(e) => setOverrideStyle(e.target.value)}
            placeholder="예: 긴장감 있게, 목소리를 낮춰서"
          />
        </div>

        {note && <p className="hint" style={{ marginTop: 12 }}>{note}</p>}
        {error && (
          <p className="error" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}

        <button className="generate-button" onClick={handleGenerate} disabled={loading}>
          {loading ? "만드는 중... (등장인물이 많으면 조금 걸려요)" : "대본 전체 듣기"}
        </button>
        <p className="hint">
          한 번에 {MAX_CHARS}자, 대사 60줄까지 가능해요. 긴 장면은 나눠서 넣어주세요.
        </p>
      </div>
    </>
  );
}
