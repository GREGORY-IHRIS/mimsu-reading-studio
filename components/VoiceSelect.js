"use client";

import { useMemo, useState } from "react";

const AGE_BUCKETS = ["20대", "30대", "40대", "50대", "60대 이상"];

function ageBucket(age) {
  if (age == null) return null;
  if (age >= 60) return "60대 이상";
  return `${Math.floor(age / 10) * 10}대`;
}

export default function VoiceSelect({ id, voices, value, onChange, openInitially = false }) {
  const [open, setOpen] = useState(openInitially);
  const [gender, setGender] = useState(null);
  const [region, setRegion] = useState(null);
  const [age, setAge] = useState(null);
  const [pitch, setPitch] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  const selected = voices.find((v) => v.id === value);
  const ready = gender !== null && region !== null && age !== null && pitch !== null;
  const matches = useMemo(() => voices.filter((v) => {
    if (gender !== "all" && v.gender !== gender) return false;
    if (region !== "all" && v.region !== region) return false;
    if (age !== "all" && ageBucket(v.age) !== age) return false;
    if (pitch !== "all" && v.pitch !== pitch) return false;
    return true;
  }), [voices, gender, region, age, pitch]);
  const searched = (showAll ? voices : matches).filter((v) =>
    `${v.displayName} ${v.tag} ${v.description || ""}`.toLowerCase().includes(search.toLowerCase())
  );
  const options = showAll ? searched : searched.slice(0, 8);

  return (
    <div className="voice-select-wrap">
      <button
        id={id}
        type="button"
        className="voice-choice-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? `${selected.displayName} · ${selected.tag}` : "목소리 고르기"} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="voice-choice-panel">
          <p className="hint">차례대로 고르면 조건에 맞는 목소리를 짧게 보여드려요.</p>
          <label>
            1. 성별
            <select value={gender ?? ""} onChange={(e) => {
              setGender(e.target.value); setRegion(null); setAge(null); setPitch(null); setShowAll(false);
            }}>
              <option value="" disabled>선택해주세요</option>
              <option value="all">상관없음</option>
              <option value="female">여성</option>
              <option value="male">남성</option>
            </select>
          </label>
          {gender !== null && <label>
            2. 말투·지역
            <select value={region ?? ""} onChange={(e) => {
              setRegion(e.target.value); setAge(null); setPitch(null); setShowAll(false);
            }}>
              <option value="" disabled>선택해주세요</option>
              <option value="all">상관없음</option>
              <option value="seoul">서울 한국어</option>
              <option value="busan">부산 한국어</option>
            </select>
          </label>}
          {region !== null && <label>
            3. 나이대
            <select value={age ?? ""} onChange={(e) => {
              setAge(e.target.value); setPitch(null); setShowAll(false);
            }}>
              <option value="" disabled>선택해주세요</option>
              <option value="all">상관없음</option>
              {AGE_BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
            </select>
          </label>}
          {age !== null && <label>
            4. 목소리 높이
            <select value={pitch ?? ""} onChange={(e) => {
              setPitch(e.target.value); setShowAll(false);
            }}>
              <option value="" disabled>선택해주세요</option>
              <option value="all">상관없음</option>
              <option value="low">낮음</option>
              <option value="medium">중간</option>
              <option value="high">높음</option>
            </select>
          </label>}
          {ready && <>
            <p className="hint">
              {showAll ? "모든 목소리" : `조건에 맞는 목소리 ${matches.length}개`}
              {!showAll && matches.length === 0 && " — 조건을 완화하거나 모든 목소리를 보세요."}
            </p>
            <input
              className="style-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="목소리 이름 검색"
              aria-label="목소리 이름 검색"
            />
            <div className="voice-choice-list">
              {options.map((v) => <button
                key={v.id}
                type="button"
                className={v.id === value ? "voice-choice-item selected" : "voice-choice-item"}
                onClick={() => { onChange(v.id); setOpen(false); }}
              >
                <strong>{v.displayName}</strong><span>{v.tag}</span>
              </button>)}
              {options.length === 0 && <p className="hint">표시할 목소리가 없어요.</p>}
            </div>
            {!showAll && <button type="button" className="chip" onClick={() => setShowAll(true)}>
              모든 목소리에서 찾기
            </button>}
            <p className="hint">다른 지역 사투리나 고유한 목소리는 <a href="#voice-designer">내 목소리 디자인하기</a>에서 설명하고 샘플을 확인할 수 있어요.</p>
          </>}
        </div>
      )}
    </div>
  );
}
