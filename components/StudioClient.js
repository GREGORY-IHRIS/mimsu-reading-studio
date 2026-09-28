"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import SingleStudio from "./SingleStudio";
import ScriptStudio from "./ScriptStudio";
import HistoryList from "./HistoryList";
import HelpModal from "./HelpModal";
import VoiceDesigner from "./VoiceDesigner";
import { withUrl } from "../lib/audio";

const DEFAULT_CAST = [{ name: "나레이터", voice: "Schedar", style: "담담하게, 차분한 나레이션 톤으로" }];

export default function StudioClient({ userEmail, userName }) {
  const [tab, setTab] = useState("single");
  const [voices, setVoices] = useState(null);
  const [cast, setCastState] = useState(DEFAULT_CAST);
  const [history, setHistory] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [voicesRes, castRes, historyRes] = await Promise.all([
        fetch("/api/voices").then((r) => r.json()),
        fetch("/api/cast").then((r) => r.json()),
        fetch("/api/history").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (voicesRes.voices) setVoices(voicesRes.voices);
      if (Array.isArray(castRes.cast) && castRes.cast.length > 0) setCastState(castRes.cast);
      if (Array.isArray(historyRes.history)) setHistory(historyRes.history.map(withUrl));
      setReady(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleVoiceCreated(voice) {
    setVoices((prev) => [voice, ...(prev || [])]);
  }

  function setCast(next) {
    setCastState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      fetch("/api/cast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cast: resolved }),
      }).catch(() => {});
      return resolved;
    });
  }

  return (
    <div className="studio">
      <div className="studio-header">
        <div className="account-bar">
          <span>{userName || userEmail}</span>
          <HelpModal />
          <button type="button" className="signout-btn" onClick={() => signOut({ callbackUrl: "/login" })}>
            로그아웃
          </button>
        </div>
        <h1>엄마의 낭독 스튜디오</h1>
        <p>쓰신 글을 붙여넣고, 목소리를 골라 들어보세요.</p>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === "single" ? "active" : ""}`}
          onClick={() => setTab("single")}
        >
          한 목소리로
        </button>
        <button
          type="button"
          className={`tab ${tab === "script" ? "active" : ""}`}
          onClick={() => setTab("script")}
        >
          여러 등장인물 (대본)
        </button>
      </div>

      {!ready && <p className="hint" style={{ textAlign: "center" }}>불러오는 중...</p>}

      {ready && voices && (
        <>
          <VoiceDesigner onCreated={handleVoiceCreated} />
          {tab === "single" && <SingleStudio voices={voices} onHistory={setHistory} />}
          {tab === "script" && (
            <ScriptStudio cast={cast} setCast={setCast} voices={voices} onHistory={setHistory} />
          )}
        </>
      )}

      <HistoryList history={history} />
    </div>
  );
}
