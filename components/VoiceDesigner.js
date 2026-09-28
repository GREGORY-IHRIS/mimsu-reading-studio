"use client";

import { useRef, useState } from "react";

const AGE_OPTIONS = [
  { value: "", label: "나이대 지정 안 함" },
  { value: "20대", label: "20대" },
  { value: "30대", label: "30대" },
  { value: "40대", label: "40대" },
  { value: "50대", label: "50대" },
  { value: "60대 이상", label: "60대 이상" },
];

const PITCH_OPTIONS = [
  { value: "", label: "톤 지정 안 함" },
  { value: "낮은", label: "낮음" },
  { value: "중간", label: "중간" },
  { value: "높은", label: "높음" },
];

function buildDescription({ gender, age, dialectMode, dialectRegion, pitch, pace, clarity, freeText }) {
  const parts = [];
  const lead = [age, gender === "female" ? "여성" : gender === "male" ? "남성" : ""].filter(Boolean).join(" ");
  if (lead) parts.push(`${lead} 목소리.`);
  if (dialectMode === "dialect" && dialectRegion.trim()) {
    parts.push(`${dialectRegion.trim()} 사투리 억양으로 말함.`);
  } else if (dialectMode === "standard") {
    parts.push("표준어를 사용함.");
  }
  if (pitch) parts.push(`목소리 톤은 ${pitch} 편.`);
  if (pace) parts.push(`${pace} 속도로 말함.`);
  if (clarity) parts.push(`${clarity} 발음함.`);
  if (freeText.trim()) parts.push(freeText.trim());
  return parts.join(" ");
}

export default function VoiceDesigner({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [age, setAge] = useState("");
  const [dialectMode, setDialectMode] = useState("standard");
  const [dialectRegion, setDialectRegion] = useState("");
  const [pitch, setPitch] = useState("");
  const [pace, setPace] = useState("");
  const [clarity, setClarity] = useState("");
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sampleUrl, setSampleUrl] = useState(null);
  const audioRef = useRef(null);

  const description = buildDescription({ gender, age, dialectMode, dialectRegion, pitch, pace, clarity, freeText });
  const canCreate = displayName.trim() && description.trim();

  async function handleCreate() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/voices/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, displayName, gender, age, dialectMode, dialectRegion, pitch }),
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
      setDisplayName("");
      setGender("unspecified");
      setAge("");
      setDialectMode("standard");
      setDialectRegion("");
      setPitch("");
      setPace("");
      setClarity("");
      setFreeText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="voice-designer" className="card voice-designer">
      <button type="button" className="voice-designer-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 내 목소리 디자인하기 (선택)
      </button>

      {open && (
        <div className="voice-designer-body">
          <p className="hint">
            아래 항목을 하나씩 골라보세요 — 성별, 말투(사투리 여부), 나이대, 톤을 정하면 자동으로
            설명 문장을 만들어드려요. 마지막에 추가로 원하는 느낌을 자유롭게 적어도 좋아요.
          </p>

          <input
            className="style-input"
            placeholder="이 목소리를 부를 이름 (예: 다정한 할머니)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <div className="wizard-grid">
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="unspecified">성별 지정 안 함</option>
              <option value="female">여성</option>
              <option value="male">남성</option>
            </select>

            <select value={dialectMode} onChange={(e) => setDialectMode(e.target.value)}>
              <option value="standard">표준어</option>
              <option value="dialect">사투리</option>
            </select>

            <select value={age} onChange={(e) => setAge(e.target.value)}>
              {AGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select value={pitch} onChange={(e) => setPitch(e.target.value)}>
              {PITCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select value={pace} onChange={(e) => setPace(e.target.value)} aria-label="말속도">
              <option value="">말속도 지정 안 함</option>
              <option value="느린">느리게</option>
              <option value="보통">보통</option>
              <option value="빠른">빠르게</option>
            </select>

            <select value={clarity} onChange={(e) => setClarity(e.target.value)} aria-label="발음 선명도">
              <option value="">발음 지정 안 함</option>
              <option value="자연스럽게">자연스럽게</option>
              <option value="또렷하게">또렷하게</option>
            </select>
          </div>

          {dialectMode === "dialect" && (
            <input
              className="style-input"
              style={{ marginTop: 8 }}
              placeholder="지역 이름 입력 (예: 경상도, 전라도, 강원도...)"
              value={dialectRegion}
              onChange={(e) => setDialectRegion(e.target.value)}
            />
          )}
          {dialectMode === "dialect" && (
            <p className="hint" style={{ marginTop: 4 }}>
              서울·부산 억양은 확장 목소리 라이브러리에서 실제로 골라 들어볼 수 있지만, 그 외
              지역 사투리는 문장 설명만으로 정확히 재현된다고 보장할 수 없어요. 대본의 사투리
              어휘·어미는 직접 써주시고, 만든 후 샘플을 꼭 들어보고 판단해주세요.
            </p>
          )}

          <textarea
            style={{ minHeight: 80, marginTop: 10 }}
            placeholder="추가로 원하는 목소리 느낌이 있다면 자유롭게 적어주세요 (선택)"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
          />

          {description && <p className="hint wizard-preview">미리보기: {description}</p>}

          {error && <p className="error">{error}</p>}

          <button type="button" className="generate-button" disabled={busy || !canCreate} onClick={handleCreate}>
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
