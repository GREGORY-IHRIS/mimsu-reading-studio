"use client";

import { useRef, useState } from "react";
import { STYLE_PRESETS } from "../lib/voices";
import { generateAndSave } from "../lib/audio";
import TagToolbar from "./TagToolbar";
import VoiceSelect from "./VoiceSelect";

const MAX_CHARS = 8000;

export default function SingleStudio({ voices, onHistory }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Sulafat");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef(null);

  async function handleGenerate() {
    setError("");
    if (!text.trim()) {
      setError("먼저 읽을 글을 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const history = await generateAndSave({ text, voice, style });
      onHistory(history);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <label className="field-label" htmlFor="text">
        읽을 글{" "}
        <span className="char-count">
          ({text.length}/{MAX_CHARS}자)
        </span>
      </label>
      <textarea
        id="text"
        ref={textareaRef}
        value={text}
        maxLength={MAX_CHARS}
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

      {error && (
        <p className="error" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      <button className="generate-button" onClick={handleGenerate} disabled={loading}>
        {loading ? "만드는 중... (몇 초 걸려요)" : "목소리로 듣기"}
      </button>
      <p className="hint">
        한 번에 {MAX_CHARS}자까지 가능해요. 긴 글은 장면 단위로 나눠서 넣어주시면 더 좋아요.
      </p>
    </div>
  );
}
