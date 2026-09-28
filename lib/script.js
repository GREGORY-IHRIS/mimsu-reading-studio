// Parses a lightweight screenplay-style script into speaker turns.
//
// Rules (kept simple on purpose so a non-technical writer can learn them
// in one glance):
//   - A line like "이름: 대사" starts a new turn for that speaker.
//   - A line with no recognizable "이름:" prefix continues the *previous*
//     speaker's turn (so a character's paragraph can span several lines).
//   - Blank lines are ignored.
//
// A prefix only counts as a name if it's short and doesn't look like a
// sentence fragment that happens to contain a colon (e.g. "오후 3시: 정각").
const NAME_PREFIX = /^([^:：]{1,12})[:：]\s*(.*)$/;
const SENTENCE_ENDINGS = /[.?!다요]$/;

function looksLikeName(candidate, knownNames) {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (knownNames.has(trimmed.toLowerCase())) return true;
  if (trimmed.includes("  ")) return false;
  if (SENTENCE_ENDINGS.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 2;
}

export function parseScript(rawText, castList) {
  const known = new Set(castList.map((c) => c.name.trim().toLowerCase()));
  const narratorName = castList[0]?.name || "나레이터";
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  const turns = [];
  const unknownSpeakers = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(NAME_PREFIX);
    if (match && looksLikeName(match[1], known)) {
      const speaker = match[1].trim();
      const rest = match[2].trim();
      if (!known.has(speaker.toLowerCase()) && !unknownSpeakers.includes(speaker)) {
        unknownSpeakers.push(speaker);
      }
      current = { speaker, text: rest ? [rest] : [] };
      turns.push(current);
    } else if (current) {
      current.text.push(line);
    } else {
      current = { speaker: narratorName, text: [line] };
      turns.push(current);
    }
  }

  return {
    turns: turns.map((t) => ({ speaker: t.speaker, text: t.text.join(" ").trim() })).filter((t) => t.text),
    unknownSpeakers,
  };
}

export function nextAvailableVoice(voices, castList) {
  const used = new Set(castList.map((c) => c.voice));
  const free = voices.find((v) => !used.has(v.id));
  return (free || voices[Math.floor(Math.random() * voices.length)]).id;
}
