import { NextResponse } from "next/server";
import { TTS_MODEL } from "../../../../lib/shared/config.js";
import { GeminiError, callGemini, extractAudio } from "../../../../lib/server/gemini.js";
import { jsonError, requireApiKey, requireSession } from "../../../../lib/server/http.js";
import { saveCustomVoice, userKeyFor } from "../../../../lib/server/store.js";

export const maxDuration = 60;

const MAX_DESCRIPTION = 500;

// The Voice Design response shape is new/undocumented enough that we look for
// the id rather than assuming one exact nesting.
function extractVoiceId(json) {
  return json?.voice?.id || json?.id || json?.name || null;
}

export async function POST(request) {
  const { session, response } = await requireSession();
  if (response) return response;
  const { apiKey, response: keyResponse } = requireApiKey();
  if (keyResponse) return keyResponse;

  const body = await request.json().catch(() => null);
  const description = (body?.description || "").trim();
  const displayName = (body?.displayName || "").trim();
  const gender = body?.gender === "male" || body?.gender === "female" ? body.gender : "unspecified";
  const age = Number.parseInt(body?.age, 10) || null;
  const region = body?.dialectMode === "standard" ? "seoul" : body?.dialectRegion?.trim() === "부산" ? "busan" : null;
  const pitch = { 낮은: "low", 중간: "medium", 높은: "high" }[body?.pitch] || null;

  if (!description) return jsonError("원하는 목소리를 문장으로 설명해주세요.", 400);
  if (description.length > MAX_DESCRIPTION) return jsonError(`설명은 ${MAX_DESCRIPTION}자 이하로 적어주세요.`, 400);
  if (!displayName) return jsonError("이 목소리를 부를 이름을 정해주세요.", 400);

  const user = userKeyFor(session.user.email).slice(0, 8);
  let json;
  try {
    ({ json } = await callGemini({
      path: "/voices",
      body: {
        store: true,
        voice: {
          model: TTS_MODEL,
          type: "prompted",
          display_name: displayName,
          gender,
          language_code: "ko-KR",
          prompted: { input: description },
        },
      },
      apiKey,
      // Assumed to count toward the TTS daily limit: creating a voice renders a sample.
      context: { bucket: "tts", purpose: "voice-design", model: TTS_MODEL, user, details: { chars: description.length } },
      inspect: (result) => (extractVoiceId(result) ? {} : { error: "목소리는 만들어졌지만 식별값을 받지 못했어요." }),
    }));
  } catch (error) {
    if (!(error instanceof GeminiError)) throw error;
    return jsonError(error.message, 502, { code: error.code });
  }

  const sample = extractAudio(json);
  const voice = {
    id: extractVoiceId(json),
    displayName,
    tag: gender === "male" ? "남성 · 내 디자인" : gender === "female" ? "여성 · 내 디자인" : "내 디자인",
    description,
    gender,
    age,
    region,
    pitch,
    createdAt: new Date().toISOString(),
  };
  await saveCustomVoice(session.user.email, voice);

  return NextResponse.json({
    voice: { ...voice, group: "내가 만든 목소리" },
    sampleAudioBase64: sample?.base64 || null,
    sampleMimeType: sample?.mimeType || "audio/wav",
  });
}
