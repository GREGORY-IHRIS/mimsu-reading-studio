"use client";

import { useMemo, useRef, useState } from "react";
import CastManager from "./CastManager";
import GenerateButton from "./GenerateButton";
import QuotaEstimate from "./QuotaEstimate";
import TagToolbar from "./TagToolbar";
import useSpeechGeneration from "./useSpeechGeneration";
import { formatScript } from "../lib/client/api.js";
import { scriptEntryInfo } from "../lib/client/generate.js";
import { MAX_TEXT_CHARS } from "../lib/shared/config.js";
import { nextAvailableVoice, parseScript } from "../lib/shared/script.js";
import { buildVoiceStyle } from "../lib/shared/voiceStyle.js";

const EXAMPLE = `밤안개가 골목 끝까지 자욱하게 내려앉았다.
지우: 누구야...? 거기 누구 있어?
그림자가 천천히 다가왔다.
민준: 나야, 놀라지 마.`;

// Attaches each parsed line to its cast member's voice and delivery style.
function toTurns(parsedTurns, cast, fallbackVoice, overrideStyle) {
  const byName = new Map(cast.map((c) => [c.name.toLowerCase(), c]));
  return parsedTurns.map((turn) => {
    const character = byName.get(turn.speaker.toLowerCase());
    return {
      speaker: turn.speaker,
      voice: character?.voice || fallbackVoice,
      style: overrideStyle.trim() || buildVoiceStyle(character),
      text: turn.text,
    };
  });
}

// The cast plus a free voice for every name that is not in it yet.
function withNewcomers(cast, unknownSpeakers, voices) {
  const additions = [];
  for (const name of unknownSpeakers) {
    additions.push({ name, voice: nextAvailableVoice(voices, [...cast, ...additions], name), style: "" });
  }
  return additions.length ? [...cast, ...additions] : cast;
}

export default function ScriptStudio({ cast, setCast, voices, onLibrary }) {
  const [scriptText, setScriptText] = useState("");
  const [overrideStyle, setOverrideStyle] = useState("");
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const textareaRef = useRef(null);
  const generation = useSpeechGeneration(onLibrary);

  const preview = useMemo(() => parseScript(scriptText, cast), [scriptText, cast]);
  // The estimate must use the voices the job will really use, including the
  // ones handed out to characters that are not in the cast yet.
  const estimateTurns = useMemo(
    () => (voices.length ? toTurns(preview.turns, withNewcomers(cast, preview.unknownSpeakers, voices), voices[0].id, overrideStyle) : []),
    [preview, cast, voices, overrideStyle]
  );

  async function handleAutoFormat() {
    setError("");
    setNote("");
    if (!scriptText.trim()) {
      setError("정리할 글을 먼저 입력해주세요.");
      return;
    }
    setFormatting(true);
    try {
      setScriptText(await formatScript(scriptText, cast.map((c) => c.name)));
      setNote("AI가 대사와 나레이션을 구분해봤어요 — 생성 전에 한 번 훑어보고 틀린 부분은 직접 고쳐주세요.");
    } catch (e) {
      setError(e.message);
    } finally {
      setFormatting(false);
    }
  }

  function handleGenerate() {
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

    const workingCast = withNewcomers(cast, parsed.unknownSpeakers, voices);
    if (parsed.unknownSpeakers.length > 0) {
      setCast(workingCast);
      setNote(
        `새 등장인물을 발견해서 목소리를 자동으로 배정했어요: ${workingCast
          .slice(cast.length)
          .map((a) => `${a.name}(${a.voice})`)
          .join(", ")}. 마음에 안 들면 위 출연진 목록에서 바꾸고 다시 생성해주세요.`
      );
    }

    const turns = toTurns(parsed.turns, workingCast, voices[0].id, overrideStyle);
    generation.run({ turns, purpose: "script", entry: scriptEntryInfo(turns) });
  }

  const detectedSpeakers = Array.from(new Set(preview.turns.map((t) => t.speaker)));
  const shownError = error || generation.error;

  return (
    <>
      <CastManager cast={cast} setCast={setCast} voices={voices} />

      <div className="card">
        <label className="field-label" htmlFor="script">
          대본{" "}
          <span className="char-count">
            ({scriptText.length}/{MAX_TEXT_CHARS}자)
          </span>
        </label>
        <textarea
          id="script"
          ref={textareaRef}
          value={scriptText}
          maxLength={MAX_TEXT_CHARS}
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
        {shownError && (
          <p className="error" style={{ marginTop: 16 }}>
            {shownError}
          </p>
        )}

        <GenerateButton
          idleLabel="대본 전체 듣기"
          loading={generation.loading}
          progress={generation.progress}
          onGenerate={handleGenerate}
          onStop={generation.stop}
        />
        <QuotaEstimate turns={estimateTurns} busy={generation.loading} />
        <p className="hint">
          한 번에 {MAX_TEXT_CHARS}자까지 가능해요. 긴 대본은 자동으로 여러 구간으로 나눠 순서대로 만들고,
          만든 구간은 이 브라우저에 저장해 둬요 — 실패하거나 하루 한도에 걸려도, 글을 조금 고쳐도
          바뀐 구간만 다시 만들어요.
        </p>
      </div>
    </>
  );
}
