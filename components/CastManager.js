"use client";

import { useRef, useState } from "react";
import { nextAvailableVoice } from "../lib/shared/script.js";
import { previewSpeech } from "../lib/client/api.js";
import { buildVoiceStyle } from "../lib/shared/voiceStyle.js";
import VoiceSelect from "./VoiceSelect";

const SAMPLE_TEXT = "안녕하세요, 목소리를 확인하고 있어요.";

export default function CastManager({ cast, setCast, voices }) {
  const [newName, setNewName] = useState("");
  const [newVoice, setNewVoice] = useState(() => nextAvailableVoice(voices, cast));
  const [voiceTouched, setVoiceTouched] = useState(false);
  const [newPace, setNewPace] = useState("");
  const [newClarity, setNewClarity] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [previewing, setPreviewing] = useState(null);
  const [previewError, setPreviewError] = useState("");
  // Each preview is a Gemini request, so a voice that was already sampled is replayed from memory.
  const previewUrls = useRef(new Map());

  function handleNameChange(value) {
    setNewName(value);
    if (!voiceTouched) {
      setNewVoice(nextAvailableVoice(voices, cast, value));
    }
  }

  function updateCast(index, patch) {
    setCast((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeCast(index) {
    setCast((prev) => prev.filter((_, i) => i !== index));
  }

  function addCast() {
    const name = newName.trim();
    if (!name) return;
    if (cast.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return;
    }
    const nextCast = [...cast, { name, voice: newVoice, pace: newPace, clarity: newClarity, style: newStyle.trim() }];
    setCast(nextCast);
    setNewName("");
    setVoiceTouched(false);
    setNewPace("");
    setNewClarity("");
    setNewStyle("");
    setNewVoice(nextAvailableVoice(voices, nextCast));
  }

  async function preview(voice, style, key) {
    setPreviewing(key);
    setPreviewError("");
    try {
      const cacheKey = `${voice}|${style}`;
      let url = previewUrls.current.get(cacheKey);
      if (!url) {
        url = await previewSpeech({ text: SAMPLE_TEXT, voice, style });
        previewUrls.current.set(cacheKey, url);
      }
      new Audio(url).play();
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewing(null);
    }
  }

  return (
    <div className="card">
      <label className="field-label">등장인물 캐스팅</label>
      <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
        한 번만 설정해두면 계정에 저장돼서 다음에 또 고를 필요 없어요.
      </p>

      {cast.map((c, i) => (
        <div className="cast-row" key={i}>
          <input
            className="cast-name"
            value={c.name}
            disabled={i === 0}
            onChange={(e) => updateCast(i, { name: e.target.value })}
          />
          <VoiceSelect voices={voices} value={c.voice} onChange={(v) => updateCast(i, { voice: v })} />
          <input
            className="cast-style"
            placeholder="추가로 원하는 연기·목소리 느낌 (선택)"
            value={c.style || ""}
            onChange={(e) => updateCast(i, { style: e.target.value })}
          />
          <select
            className="cast-detail-select"
            aria-label={`${c.name} 말속도`}
            value={c.pace || ""}
            onChange={(e) => updateCast(i, { pace: e.target.value })}
          >
            <option value="">말속도 기본</option>
            <option value="slow">느리게</option>
            <option value="normal">보통</option>
            <option value="fast">빠르게</option>
          </select>
          <select
            className="cast-detail-select"
            aria-label={`${c.name} 발음 선명도`}
            value={c.clarity || ""}
            onChange={(e) => updateCast(i, { clarity: e.target.value })}
          >
            <option value="">발음 기본</option>
            <option value="natural">자연스럽게</option>
            <option value="clear">또렷하게</option>
          </select>
          <button
            type="button"
            className="cast-preview"
            onClick={() => preview(c.voice, buildVoiceStyle(c), i)}
            disabled={previewing === i}
          >
            {previewing === i ? "..." : "미리듣기"}
          </button>
          {i > 0 && (
            <button type="button" className="cast-remove" onClick={() => removeCast(i)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {previewError && <p className="error" style={{ marginTop: 8 }}>{previewError}</p>}
      <p className="hint">
        "미리듣기"는 처음 들을 때마다 Gemini 요청을 1회 써요 (같은 목소리를 다시 들을 땐 쓰지 않아요).
      </p>

      <div className="cast-create">
        <label className="field-label" htmlFor="new-cast-name">새 등장인물 추가</label>
        <input
          id="new-cast-name"
          className="cast-name"
          placeholder="새 등장인물 이름 (예: 할머니, 엄마)"
          value={newName}
          onChange={(e) => handleNameChange(e.target.value)}
        />
        {newName.trim() && <>
          <p className="hint">이름을 적으면 목소리 선택이 열려요. 추천 목소리를 그대로 써도 되고 직접 고를 수도 있어요.</p>
          <VoiceSelect
            voices={voices}
            value={newVoice}
            openInitially
            onChange={(v) => {
              setVoiceTouched(true);
              setNewVoice(v);
            }}
          />
          <label>
            5. 말속도
            <select value={newPace} onChange={(e) => setNewPace(e.target.value)}>
              <option value="">기본</option>
              <option value="slow">느리게</option>
              <option value="normal">보통</option>
              <option value="fast">빠르게</option>
            </select>
          </label>
          <label>
            6. 발음 선명도
            <select value={newClarity} onChange={(e) => setNewClarity(e.target.value)}>
              <option value="">기본</option>
              <option value="natural">자연스럽게</option>
              <option value="clear">또렷하게</option>
            </select>
          </label>
          <label>
            7. 추가로 원하는 느낌 (선택)
            <textarea
              value={newStyle}
              onChange={(e) => setNewStyle(e.target.value)}
              placeholder="예: 다정하지만 장난기가 조금 있고, 문장 끝은 부드럽게"
            />
          </label>
          <p className="hint">말속도·발음·추가 느낌은 대사를 읽을 때 적용됩니다. 목소리 자체를 새로 만들려면 위의 ‘내 목소리 디자인하기’를 이용하세요.</p>
          <button type="button" className="cast-add" onClick={addCast}>
            + 등장인물 추가
          </button>
        </>}
      </div>
    </div>
  );
}
