"use client";

import { useState } from "react";

const NEW_FOLDER = "__new__";

// Only one recording plays at a time, wherever it is on the page.
let playing = null;
function handlePlay(event) {
  if (playing && playing !== event.currentTarget) playing.pause();
  playing = event.currentTarget;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// One saved recording: title (click to rename), player, star, folder, download,
// delete. Draggable onto a folder in the library.
export default function ClipCard({ entry, folders, busy, actions, autoPlay = false, draggable = false }) {
  const [naming, setNaming] = useState(false);

  function changeFolder(value) {
    if (value === NEW_FOLDER) {
      setNaming(true);
      return;
    }
    actions.patch(entry.id, { folder: value || null });
  }

  function finishNaming(value) {
    setNaming(false);
    const name = value.trim();
    if (name) actions.patch(entry.id, { folder: name });
  }

  function rename(value) {
    const name = value.trim();
    if (name !== (entry.name ?? "")) actions.patch(entry.id, { name });
  }

  function remove() {
    if (confirm("이 음성을 지울까요? 되돌릴 수 없어요.")) actions.remove(entry.id);
  }

  return (
    <article
      className={`clip ${busy ? "busy" : ""}`}
      draggable={draggable}
      onDragStart={(event) => event.dataTransfer.setData("text/clip-id", entry.id)}
    >
      <header className="clip-head">
        <button
          type="button"
          className={`clip-star ${entry.pinned ? "on" : ""}`}
          title={entry.pinned ? "즐겨찾기 해제" : "즐겨찾기 (자동으로 지워지지 않아요)"}
          onClick={() => actions.patch(entry.id, { pinned: !entry.pinned })}
          disabled={busy}
        >
          {entry.pinned ? "★" : "☆"}
        </button>
        <input
          key={entry.id + (entry.name || "")}
          className="clip-title"
          defaultValue={entry.name || entry.label}
          placeholder={entry.label}
          title="눌러서 이름 바꾸기"
          onBlur={(event) => rename(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          disabled={busy}
        />
      </header>

      <p className="clip-meta">
        <span>{formatDate(entry.createdAt)}</span>
        <span className="clip-label">{entry.label}</span>
      </p>
      {entry.snippet && <p className="clip-snippet">“{entry.snippet}”</p>}

      <audio controls preload="none" src={entry.url} autoPlay={autoPlay} onPlay={handlePlay} />

      <footer className="clip-foot">
        {naming ? (
          <input
            className="clip-folder-new"
            autoFocus
            placeholder="새 폴더 이름, Enter"
            onKeyDown={(event) => {
              if (event.key === "Enter") finishNaming(event.currentTarget.value);
              if (event.key === "Escape") setNaming(false);
            }}
            onBlur={(event) => finishNaming(event.currentTarget.value)}
          />
        ) : (
          <select
            className="clip-folder"
            value={entry.folder || ""}
            onChange={(event) => changeFolder(event.target.value)}
            disabled={busy}
            aria-label="폴더에 넣기"
          >
            <option value="">📂 폴더에 넣기</option>
            {folders.map((name) => <option key={name} value={name}>📁 {name}</option>)}
            <option value={NEW_FOLDER}>＋ 새 폴더 만들기</option>
          </select>
        )}
        <a className="clip-btn" href={entry.url} download={`${entry.name || "낭독"}_${entry.id}.${entry.ext}`}>
          내려받기
        </a>
        <button type="button" className="clip-btn danger" onClick={remove} disabled={busy}>
          삭제
        </button>
      </footer>
    </article>
  );
}
