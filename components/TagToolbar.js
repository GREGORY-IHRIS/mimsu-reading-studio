"use client";

const TAGS = [
  { label: "한숨", tag: "<sigh>" },
  { label: "웃음", tag: "<laugh>" },
  { label: "헛기침", tag: "<cough>" },
  { label: "짧게 멈춤", tag: "<short pause>" },
  { label: "길게 멈춤", tag: "<long pause>" },
];

export default function TagToolbar({ textareaRef, value, onChange }) {
  function insert(tag) {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + tag);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + tag + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="tag-toolbar">
      <span className="tag-toolbar-label">커서 위치에 삽입:</span>
      {TAGS.map((t) => (
        <button type="button" key={t.tag} className="tag-btn" onClick={() => insert(t.tag)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
