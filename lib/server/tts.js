import { TTS_MODEL } from "../shared/config.js";
import { buildTtsRequest } from "../shared/ttsRequest.js";
import { extractAudio, callGemini } from "./gemini.js";

// One Gemini text-to-speech call for one group of turns (already validated
// with validateCall). No retries and no fallbacks here: each attempt costs
// quota, so the decision to try again is made by the browser, which can see
// the ledger and tell the user (see lib/client/speechJob.js).
export async function synthesize({ turns, apiKey, user, purpose, job }) {
  const chars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  let audio = null;

  const { usage } = await callGemini({
    path: "/interactions",
    body: buildTtsRequest(turns),
    apiKey,
    context: {
      bucket: "tts",
      purpose,
      model: TTS_MODEL,
      user,
      details: {
        chars,
        lines: turns.length,
        speakers: new Set(turns.map((turn) => turn.speaker)).size,
        ...(job ? { job } : {}),
      },
    },
    inspect(json) {
      audio = extractAudio(json);
      if (!audio) return { error: "음성 데이터를 받지 못했어요." };
      return { extra: { audioKB: Math.round((audio.base64.length * 3) / 4 / 1024) } };
    },
  });
  return { audio, usage };
}
