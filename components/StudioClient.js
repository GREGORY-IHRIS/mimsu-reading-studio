"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import SingleStudio from "./SingleStudio";
import ScriptStudio from "./ScriptStudio";
import Library from "./Library";
import ClipCard from "./ClipCard";
import useLibraryActions from "./useLibraryActions";
import HelpModal from "./HelpModal";
import UsagePanel from "./UsagePanel";
import { UsageProvider } from "./UsageProvider";
import VoiceDesigner from "./VoiceDesigner";
import { fetchLibrary } from "../lib/client/api.js";
import { DEFAULT_CAST } from "../lib/shared/voices.js";

export default function StudioClient(props) {
  return (
    <UsageProvider>
      <Studio {...props} />
    </UsageProvider>
  );
}

function Studio({ userEmail, userName }) {
  const [tab, setTab] = useState("single");
  const [voices, setVoices] = useState(null);
  const [cast, setCastState] = useState(DEFAULT_CAST);
  const [library, setLibraryState] = useState({ history: [], folders: [] });
  const [justMadeId, setJustMadeId] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [voicesRes, castRes, libraryRes] = await Promise.all([
        fetch("/api/voices").then((r) => r.json()),
        fetch("/api/cast").then((r) => r.json()),
        fetchLibrary().catch(() => null),
      ]);
      if (cancelled) return;
      if (voicesRes.voices) setVoices(voicesRes.voices);
      if (Array.isArray(castRes.cast) && castRes.cast.length > 0) setCastState(castRes.cast);
      if (libraryRes) setLibraryState(libraryRes);
      setReady(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // A new recording at the top of the list is the one just generated: show it
  // right under the generate button so it can be played straight away.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const setLibrary = useCallback((next) => {
    const known = libraryRef.current.history;
    const newest = next.history[0];
    if (newest && !known.some((h) => h.id === newest.id)) setJustMadeId(newest.id);
    setLibraryState(next);
  }, []);

  const actions = useLibraryActions(setLibraryState);
  const justMade = library.history.find((h) => h.id === justMadeId);

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
          <Library library={library} onLibrary={setLibraryState} />
          <UsagePanel />
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
          {tab === "single" && <SingleStudio voices={voices} onLibrary={setLibrary} />}
          {tab === "script" && (
            <ScriptStudio cast={cast} setCast={setCast} voices={voices} onLibrary={setLibrary} />
          )}
        </>
      )}

      {justMade && (
        <div className="card just-made">
          <div className="just-made-head">
            <strong>방금 만든 음성</strong>
            <button type="button" className="link-btn" onClick={() => setJustMadeId(null)}>닫기</button>
          </div>
          <ClipCard
            key={justMade.id}
            entry={justMade}
            folders={library.folders}
            actions={actions}
            busy={actions.busyId === justMade.id}
            autoPlay
          />
          <p className="hint">모든 음성은 위쪽 ‘보관함’에 모여요. 폴더에 넣거나 ★ 표시하면 자동으로 지워지지 않아요.</p>
        </div>
      )}
    </div>
  );
}
