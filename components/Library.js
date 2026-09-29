"use client";

import { useEffect, useMemo, useState } from "react";
import ClipCard from "./ClipCard";
import useLibraryActions from "./useLibraryActions";

const ALL = "__all__";
const STARRED = "__starred__";
const LOOSE = "__loose__";

const SORTS = {
  newest: { label: "최신순", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  oldest: { label: "오래된순", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  name: {
    label: "이름순",
    compare: (a, b) => (a.name || a.label).localeCompare(b.name || b.label, "ko"),
  },
};

function FolderIcon({ open }) {
  return (
    <svg viewBox="0 0 48 40" className="shelf-icon" aria-hidden="true">
      <path
        d="M4 9a4 4 0 0 1 4-4h11l4 5h17a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="currentColor" opacity={open ? 0.55 : 0.32}
      />
      <path d="M4 16h40v17a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" opacity={open ? 1 : 0.8} />
    </svg>
  );
}

// A folder on the shelf. Recordings can be dragged onto it (onDrop).
function Shelf({ id, icon, label, count, active, onOpen, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`shelf ${active ? "active" : ""} ${over ? "over" : ""}`}
      onDragOver={onDrop ? (event) => { event.preventDefault(); setOver(true); } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop ? (event) => {
        event.preventDefault();
        setOver(false);
        onDrop(event.dataTransfer.getData("text/clip-id"));
      } : undefined}
    >
      <button type="button" className="shelf-open" onClick={() => onOpen(id)}>
        {icon}
        <span className="shelf-name">{label}</span>
        <span className="shelf-count">{count}</span>
      </button>
    </div>
  );
}

function LibraryView({ library, onLibrary, onClose }) {
  const { history, folders } = library;
  const actions = useLibraryActions(onLibrary);
  const [current, setCurrent] = useState(ALL);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [addingFolder, setAddingFolder] = useState(false);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const counts = useMemo(() => {
    const byFolder = Object.fromEntries(folders.map((name) => [name, 0]));
    let starred = 0;
    let loose = 0;
    for (const entry of history) {
      if (entry.folder) byFolder[entry.folder] = (byFolder[entry.folder] || 0) + 1;
      else loose += 1;
      if (entry.pinned) starred += 1;
    }
    return { byFolder, starred, loose };
  }, [history, folders]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history
      .filter((entry) => {
        if (current === STARRED) return entry.pinned;
        if (current === LOOSE) return !entry.folder;
        if (current !== ALL) return entry.folder === current;
        return true;
      })
      .filter((entry) => !needle
        || [entry.name, entry.label, entry.snippet, entry.folder].some((text) => text?.toLowerCase().includes(needle)))
      .sort(SORTS[sort].compare);
  }, [history, current, query, sort]);

  const isUserFolder = folders.includes(current);
  const title = {
    [ALL]: "전체 음성", [STARRED]: "즐겨찾기", [LOOSE]: "폴더에 안 넣은 음성",
  }[current] || current;

  async function submitFolder(value) {
    setAddingFolder(false);
    const name = value.trim();
    if (!name) return;
    if (await actions.addFolder(name)) setCurrent(name);
  }

  async function handleRename() {
    const name = prompt("폴더 새 이름", current)?.trim();
    if (!name || name === current) return;
    if (await actions.renameFolder(current, name)) setCurrent(name);
  }

  async function handleDeleteFolder() {
    const message = `'${current}' 폴더를 지울까요?\n안에 있는 음성은 지워지지 않고 '폴더에 안 넣은 음성'으로 옮겨져요.`;
    if (!confirm(message)) return;
    if (await actions.removeFolder(current)) setCurrent(ALL);
  }

  const moveInto = (folder) => (clipId) => clipId && actions.patch(clipId, { folder });

  return (
    <div className="lib-backdrop" role="dialog" aria-modal="true" aria-label="내 보관함">
      <div className="lib">
        <header className="lib-top">
          <div>
            <h2>내 보관함</h2>
            <p>만든 음성 {history.length}개 · 폴더 {folders.length}개</p>
          </div>
          <button type="button" className="lib-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="lib-shelves">
          <Shelf id={ALL} label="전체" count={history.length} active={current === ALL} onOpen={setCurrent}
            icon={<FolderIcon open={current === ALL} />} />
          <Shelf id={STARRED} label="즐겨찾기" count={counts.starred} active={current === STARRED}
            onOpen={setCurrent} icon={<span className="shelf-glyph">★</span>}
            onDrop={(clipId) => clipId && actions.patch(clipId, { pinned: true })} />
          <Shelf id={LOOSE} label="정리 전" count={counts.loose} active={current === LOOSE}
            onOpen={setCurrent} icon={<span className="shelf-glyph">🗂</span>} onDrop={moveInto(null)} />
          {folders.map((name) => (
            <Shelf key={name} id={name} label={name} count={counts.byFolder[name] || 0}
              active={current === name} onOpen={setCurrent} icon={<FolderIcon open={current === name} />}
              onDrop={moveInto(name)} />
          ))}
          {addingFolder ? (
            <div className="shelf new">
              <input
                autoFocus
                placeholder="폴더 이름, Enter"
                maxLength={40}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitFolder(event.currentTarget.value);
                  if (event.key === "Escape") setAddingFolder(false);
                }}
                onBlur={(event) => submitFolder(event.currentTarget.value)}
              />
            </div>
          ) : (
            <button type="button" className="shelf add" onClick={() => setAddingFolder(true)}>
              <span className="shelf-glyph">＋</span>
              <span className="shelf-name">새 폴더</span>
            </button>
          )}
        </div>

        <div className="lib-bar">
          <div className="lib-heading">
            <h3>{title}</h3>
            {isUserFolder && (
              <span className="lib-folder-tools">
                <button type="button" onClick={handleRename}>이름 바꾸기</button>
                <button type="button" onClick={handleDeleteFolder}>폴더 지우기</button>
              </span>
            )}
          </div>
          <div className="lib-filter">
            <input
              type="search"
              placeholder="이름·내용으로 찾기"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="정렬">
              {Object.entries(SORTS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="lib-empty">
            {history.length === 0
              ? "아직 만든 음성이 없어요. 음성을 만들면 여기에 차곡차곡 모여요."
              : query
                ? "찾는 음성이 없어요."
                : "여기는 비어 있어요. 음성 카드를 끌어다 놓거나, 카드의 ‘폴더에 넣기’를 써보세요."}
          </p>
        ) : (
          <div className="lib-grid">
            {shown.map((entry) => (
              <ClipCard key={entry.id} entry={entry} folders={folders} actions={actions}
                busy={actions.busyId === entry.id} draggable />
            ))}
          </div>
        )}

        <p className="lib-note">
          폴더에 넣거나 ★ 표시한 음성은 자동으로 지워지지 않아요. 그 외 음성은 가장 최근 50개까지만 남아요.
        </p>
      </div>
    </div>
  );
}

export default function Library({ library, onLibrary }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="signout-btn" onClick={() => setOpen(true)}>
        보관함{library.history.length ? ` ${library.history.length}` : ""}
      </button>
      {open && <LibraryView library={library} onLibrary={onLibrary} onClose={() => setOpen(false)} />}
    </>
  );
}
