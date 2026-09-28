"use client";

import { useMemo, useState } from "react";
import { patchHistoryEntry, deleteHistoryEntry } from "../lib/audio";

const NEW_FOLDER = "__new__";

export default function HistoryList({ history, onHistory }) {
  const [activeFolder, setActiveFolder] = useState("all");
  const [addingFolderFor, setAddingFolderFor] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const folders = useMemo(
    () => Array.from(new Set(history.map((h) => h.folder).filter(Boolean))).sort(),
    [history]
  );

  const visible = activeFolder === "all" ? history : history.filter((h) => h.folder === activeFolder);

  async function withBusy(id, fn) {
    setBusyId(id);
    try {
      const next = await fn();
      onHistory(next);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleRename(h, value) {
    const trimmed = value.trim();
    const current = h.name ?? "";
    if (trimmed === current) return;
    withBusy(h.id, () => patchHistoryEntry(h.id, { name: trimmed }));
  }

  function handleTogglePin(h) {
    withBusy(h.id, () => patchHistoryEntry(h.id, { pinned: !h.pinned }));
  }

  function handleFolderChange(h, value) {
    if (value === NEW_FOLDER) {
      setAddingFolderFor(h.id);
      return;
    }
    withBusy(h.id, () => patchHistoryEntry(h.id, { folder: value || null }));
  }

  function handleNewFolderSubmit(h, name) {
    setAddingFolderFor(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    withBusy(h.id, () => patchHistoryEntry(h.id, { folder: trimmed }));
  }

  function handleDelete(h) {
    if (!confirm("정말 삭제할까요? 되돌릴 수 없어요.")) return;
    withBusy(h.id, () => deleteHistoryEntry(h.id));
  }

  if (history.length === 0) return null;

  return (
    <div className="card">
      <label className="field-label">들어본 목소리</label>

      {folders.length > 0 && (
        <div className="folder-tabs">
          <button
            type="button"
            className={`folder-tab ${activeFolder === "all" ? "active" : ""}`}
            onClick={() => setActiveFolder("all")}
          >
            전체
          </button>
          {folders.map((f) => (
            <button
              type="button"
              key={f}
              className={`folder-tab ${activeFolder === f ? "active" : ""}`}
              onClick={() => setActiveFolder(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {visible.map((h, i) => (
        <div className="history-item" key={h.id}>
          <div className="history-top-row">
            <button
              type="button"
              className={`pin-btn ${h.pinned ? "active" : ""}`}
              title={h.pinned ? "찜 해제 (다시 누르면 자동삭제 대상에 포함돼요)" : "찜하기 (자동삭제에서 제외돼요)"}
              onClick={() => handleTogglePin(h)}
              disabled={busyId === h.id}
            >
              {h.pinned ? "★" : "☆"}
            </button>
            <input
              key={h.id + (h.name || "")}
              className="history-name-input"
              defaultValue={h.name || h.label}
              placeholder={h.label}
              onBlur={(e) => handleRename(h, e.target.value)}
              disabled={busyId === h.id}
            />
            <button
              type="button"
              className="history-delete-btn"
              onClick={() => handleDelete(h)}
              disabled={busyId === h.id}
              title="삭제"
            >
              🗑
            </button>
          </div>

          <p className="history-meta">
            {new Date(h.createdAt).toLocaleString("ko-KR")} · {h.snippet}
          </p>

          {addingFolderFor === h.id ? (
            <input
              className="folder-new-input"
              autoFocus
              placeholder="새 폴더 이름 입력 후 Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFolderSubmit(h, e.currentTarget.value);
                if (e.key === "Escape") setAddingFolderFor(null);
              }}
              onBlur={(e) => handleNewFolderSubmit(h, e.currentTarget.value)}
            />
          ) : (
            <select
              className="folder-select"
              value={h.folder || ""}
              onChange={(e) => handleFolderChange(h, e.target.value)}
              disabled={busyId === h.id}
            >
              <option value="">폴더 없음</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value={NEW_FOLDER}>+ 새 폴더 만들기</option>
            </select>
          )}

          <div className="result">
            <audio controls src={h.url} autoPlay={i === 0 && activeFolder === "all"} />
            <div className="result-actions">
              <a className="download-link" href={h.url} download={`${h.name || "낭독"}_${h.id}.${h.ext}`}>
                다운로드
              </a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
