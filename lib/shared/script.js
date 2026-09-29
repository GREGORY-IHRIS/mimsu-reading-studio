// Parses a lightweight screenplay-style script into speaker turns.
//
// Rules (kept simple on purpose so a non-technical writer can learn them
// in one glance):
//   - A line like "이름: 대사" is that character's line.
//   - A line with no recognizable "이름:" prefix is always narration —
//     even if it comes right after a character's line. A character's
//     multi-line speech needs the name repeated on each line.
//   - Consecutive narration lines are merged into one narrator turn.
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
    } else if (current && current.speaker === narratorName) {
      // Merge consecutive narration lines into one turn; a bare line
      // never continues a character's dialogue turn.
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

// Rough name → voice hints. Only the extended Korean catalog carries
// gender/age metadata (core 30 voices don't), so a hint only narrows things
// down when a matching extended voice happens to be free; otherwise it's a
// no-op and the plain "first free voice" fallback below still applies.
const NAME_VOICE_HINTS = [
  { keywords: ["할머니", "할멈"], gender: "female", minAge: 55 },
  { keywords: ["할아버지", "할배"], gender: "male", minAge: 55 },
  { keywords: ["엄마", "어머니", "모친"], gender: "female", minAge: 35, maxAge: 55 },
  { keywords: ["아빠", "아버지", "부친"], gender: "male", minAge: 35, maxAge: 55 },
  { keywords: ["이모", "고모", "아주머니", "아줌마"], gender: "female", minAge: 40 },
  { keywords: ["삼촌", "고모부", "이모부", "아저씨"], gender: "male", minAge: 40 },
  { keywords: ["누나", "언니"], gender: "female", maxAge: 30 },
  { keywords: ["형", "오빠"], gender: "male", maxAge: 30 },
  { keywords: ["소녀", "여자아이", "여자애"], gender: "female", maxAge: 25 },
  { keywords: ["소년", "남자아이", "남자애"], gender: "male", maxAge: 25 },
];

function findVoiceHint(name) {
  return NAME_VOICE_HINTS.find((hint) => hint.keywords.some((k) => name.includes(k))) || null;
}

export function nextAvailableVoice(voices, castList, name = "") {
  const used = new Set(castList.map((c) => c.voice));
  const free = voices.filter((v) => !used.has(v.id));

  const hint = name ? findVoiceHint(name) : null;
  if (hint) {
    const pool = free.length > 0 ? free : voices;
    const matches = pool.filter((v) => {
      if (v.gender !== hint.gender || typeof v.age !== "number") return false;
      if (hint.minAge != null && v.age < hint.minAge) return false;
      if (hint.maxAge != null && v.age > hint.maxAge) return false;
      return true;
    });
    if (matches.length > 0) return matches[Math.floor(Math.random() * matches.length)].id;
  }

  return (free[0] || voices[Math.floor(Math.random() * voices.length)]).id;
}
