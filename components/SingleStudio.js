"use client";

import { useMemo, useRef, useState } from "react";
import GenerateButton from "./GenerateButton";
import QuotaEstimate from "./QuotaEstimate";
import TagToolbar from "./TagToolbar";
import VoiceSelect from "./VoiceSelect";
import useSpeechGeneration from "./useSpeechGeneration";
import { singleEntryInfo } from "../lib/client/generate.js";
import { MAX_TEXT_CHARS } from "../lib/shared/config.js";
import { STYLE_PRESETS } from "../lib/shared/voices.js";

const SPEAKER = "낭독";

export default function SingleStudio({ voices, onLibrary }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Sulafat");
  const [style, setStyle] = useState("");
  const [error, setError] = useState("");
  const textareaRef = useRef(null);
  const generation = useSpeechGeneration(onLibrary);

  // Long text is cut into pieces by the same planner the script studio uses.
  const turns = useMemo(
    () => (text.trim() ? [{ speaker: SPEAKER, voice, style: style.trim(), text }] : []),
    [text, voice, style]
  );

  function handleGenerate() {
    setError("");
    if (turns.length === 0) {
      setError("먼저 읽을 글을 입력해주세요.");
      return;
    }
    generation.run({ turns, purpose: "single", entry: singleEntryInfo({ text, voice, style: style.trim() }) });
  }

  const shownError = error || generation.error;

  return (
    <div className="card">
      <label className="field-label" htmlFor="text">
        읽을 글{" "}
        <span className="char-count">
          ({text.length}/{MAX_TEXT_CHARS}자)
        </span>
      </label>
      <textarea
        id="text"
        ref={textareaRef}
        value={text}
        maxLength={MAX_TEXT_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder="여기에 대사나 장면을 붙여넣어 주세요."
      />
      <TagToolbar textareaRef={textareaRef} value={text} onChange={setText} />

      <div className="row">
        <div>
          <label className="field-label" htmlFor="voice">
            목소리
          </label>
          <VoiceSelect id="voice" voices={voices} value={voice} onChange={setVoice} />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="field-label" htmlFor="style">
          어떤 느낌으로 읽을까요? (선택)
        </label>
        <input
          id="style"
          className="style-input"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="예: 담담하게, 차분한 나레이션 톤으로"
        />
        <div className="chips">
          {STYLE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={`chip ${style === preset ? "active" : ""}`}
              onClick={() => setStyle(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {shownError && (
        <p className="error" style={{ marginTop: 16 }}>
          {shownError}
        </p>
      )}

      <GenerateButton
        idleLabel="목소리로 듣기"
        loading={generation.loading}
        progress={generation.progress}
        onGenerate={handleGenerate}
        onStop={generation.stop}
      />
      <QuotaEstimate turns={turns} busy={generation.loading} />
      <p className="hint">
        한 번에 {MAX_TEXT_CHARS}자까지 가능해요. 약 4,000자마다 Gemini 요청을 1회 쓰고, 만든 부분은 이 브라우저에
        저장해 둬서 실패해도 이어서 만들 수 있어요.
      </p>
    </div>
  );
}
