import { VOICES as CORE_VOICES } from "./voices";

const CACHE_MS = 60 * 60 * 1000; // 1 hour
let cache = { at: 0, voices: null };

async function fetchExtendedVoices(apiKey) {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/voices");
  url.searchParams.set("language_code", "ko-KR");
  url.searchParams.set("page_size", "1000");

  const res = await fetch(url, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json.voices) ? json.voices : [];
}

export async function getVoiceCatalog(apiKey) {
  if (cache.voices && Date.now() - cache.at < CACHE_MS) {
    return cache.voices;
  }

  const core = CORE_VOICES.map((v) => ({
    id: v.name,
    displayName: v.name,
    tag: v.tag,
    group: "핵심 30종 (모든 언어)",
  }));

  let extended = [];
  try {
    const raw = await fetchExtendedVoices(apiKey);
    extended = raw.map((v) => ({
      id: v.id,
      displayName: v.display_name,
      tag: [v.gender === "male" ? "남성" : v.gender === "female" ? "여성" : null, v.accent, v.pitch]
        .filter(Boolean)
        .join(" · "),
      description: v.description,
      persona: v.persona,
      group: "확장 라이브러리 (한국어 페르소나)",
    }));
  } catch {
    // extended catalog is a nice-to-have; core voices still work if this fails
  }

  const voices = [...core, ...extended];
  cache = { at: Date.now(), voices };
  return voices;
}
