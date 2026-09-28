"use client";

import { useRef, useState } from "react";

export default function VoiceDesigner({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sampleUrl, setSampleUrl] = useState(null);
  const audioRef = useRef(null);

  async function handleCreate() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/voices/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, displayName, gender }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "목소리를 만들지 못했어요.");

      if (data.sampleAudioBase64) {
        const bytes = atob(data.sampleAudioBase64);
        const buf = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
        const blob = new Blob([buf], { type: data.sampleMimeType || "audio/wav" });
        setSampleUrl(URL.createObjectURL(blob));
      } else {
        setSampleUrl(null);
      }

      onCreated?.(data.voice);
      setDescription("");
      setDisplayName("");
      setGender("unspecified");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card voice-designer">
      <button
        type="button"
        className="voice-designer-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} 내 목소리 디자인하기 (선택)
      </button>

      {open && (
        <div className="voice-designer-body">
          <p className="hint">
            원하는 목소리를 문장으로 설명해보세요. 예: "60대 후반의 다정한 할머니 목소리, 살짝
            쉰 듯하고 느긋하게 말함". 한 번 만들면 계정에 저장되어 다른 목소리처럼 계속 골라
            쓸 수 있어요.
          </p>

          <input
            className="style-input"
            placeholder="이 목소리를 부를 이름 (예: 다정한 할머니)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <div className="row" style={{ marginTop: 10 }}>
            <div>
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="unspecified">성별 지정 안 함</option>
                <option value="female">여성</option>
                <option value="male">남성</option>
              </select>
            </div>
          </div>

          <textarea
            style={{ minHeight: 100, marginTop: 10 }}
            placeholder="원하는 목소리를 자세히 설명해주세요."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="generate-button"
            disabled={busy || !description.trim() || !displayName.trim()}
            onClick={handleCreate}
          >
            {busy ? "만드는 중..." : "목소리 만들기"}
          </button>

          {sampleUrl && (
            <audio ref={audioRef} controls src={sampleUrl} style={{ width: "100%", marginTop: 14 }} />
          )}
        </div>
      )}
    </div>
  );
}
