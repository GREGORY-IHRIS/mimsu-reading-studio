"use client";

export default function VoiceSelect({ id, voices, value, onChange }) {
  const groups = new Map();
  for (const v of voices) {
    if (!groups.has(v.group)) groups.set(v.group, []);
    groups.get(v.group).push(v);
  }

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {Array.from(groups, ([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.displayName} · {v.tag}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
