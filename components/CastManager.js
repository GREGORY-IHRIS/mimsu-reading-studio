"use client";

import { useState } from "react";
import { nextAvailableVoice } from "../lib/script";
import { previewSpeech } from "../lib/audio";
import VoiceSelect from "./VoiceSelect";

const SAMPLE_TEXT = "안녕하세요, 목소리를 확인하고 있어요.";

export default function CastManager({ cast, setCast, voices }) {
  const [newName, setNewName] = useState("");
  const [newVoice, setNewVoice] = useState(() => nextAvailableVoice(voices, cast));
  const [previewing, setPreviewing] = useState(null);

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
    const nextCast = [...cast, { name, voice: newVoice, style: "" }];
    setCast(nextCast);
    setNewName("");
    setNewVoice(nextAvailableVoice(voices, nextCast));
  }

  async function preview(voice, style, key) {
    setPreviewing(key);
    try {
      const url = await previewSpeech({ text: SAMPLE_TEXT, voice, style });
      new Audio(url).play();
    } catch {
      // silent — this is just a convenience preview
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
            placeholder="기본 톤 (선택)"
            value={c.style || ""}
            onChange={(e) => updateCast(i, { style: e.target.value })}
          />
          <button
            type="button"
            className="cast-preview"
            onClick={() => preview(c.voice, c.style, i)}
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

      <div className="cast-row cast-row-new">
        <input
          className="cast-name"
          placeholder="새 등장인물 이름"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <VoiceSelect voices={voices} value={newVoice} onChange={setNewVoice} />
        <button type="button" className="cast-add" onClick={addCast} disabled={!newName.trim()}>
          + 추가
        </button>
      </div>
    </div>
  );
}
