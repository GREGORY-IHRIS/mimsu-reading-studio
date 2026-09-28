import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../lib/authOptions";
import { saveCustomVoice } from "../../../../lib/store";

export const maxDuration = 60;

const VOICES_URL = "https://generativelanguage.googleapis.com/v1beta/voices";
const MAX_DESCRIPTION = 500;

// The Voice Design response shape is new/undocumented enough that we search
// for the id and sample audio rather than assuming one exact nesting.
function extractVoiceId(json) {
  return json?.voice?.id || json?.id || json?.name || null;
}

function extractSampleAudio(json) {
  let found = null;
  (function walk(node) {
    if (found || !node || typeof node !== "object") return;
    if (typeof node.data === "string" && node.data.length > 100) {
      const mt = node.mime_type || node.mimeType;
      if (!mt || String(mt).startsWith("audio/")) {
        found = { base64: node.data, mimeType: mt || "audio/wav" };
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (found) return;
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object") walk(value);
    }
  })(json);
  return found;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버에 GEMINI_API_KEY가 없어요." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const description = (body?.description || "").trim();
  const displayName = (body?.displayName || "").trim();
  const gender = body?.gender === "male" || body?.gender === "female" ? body.gender : "unspecified";
  const age = Number.parseInt(body?.age, 10) || null;
  const region = body?.dialectMode === "standard" ? "seoul" : body?.dialectRegion?.trim() === "부산" ? "busan" : null;
  const pitch = { 낮은: "low", 중간: "medium", 높은: "high" }[body?.pitch] || null;

  if (!description) {
    return NextResponse.json({ error: "원하는 목소리를 문장으로 설명해주세요." }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION) {
    return NextResponse.json(
      { error: `설명은 ${MAX_DESCRIPTION}자 이하로 적어주세요.` },
      { status: 400 }
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "이 목소리를 부를 이름을 정해주세요." }, { status: 400 });
  }

  const requestBody = {
    store: true,
    voice: {
      model: "gemini-3.8-flash-tts",
      type: "prompted",
      display_name: displayName,
      gender,
      language_code: "ko-KR",
      prompted: { input: description },
    },
  };

  let res;
  try {
    res = await fetch(VOICES_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return NextResponse.json({ error: "Gemini 서버에 연결하지 못했어요." }, { status: 502 });
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json(
      { error: json?.error?.message || `목소리 생성에 실패했어요 (HTTP ${res.status})` },
      { status: 502 }
    );
  }

  const voiceId = extractVoiceId(json);
  if (!voiceId) {
    return NextResponse.json({ error: "목소리는 만들어졌지만 식별값을 받지 못했어요." }, { status: 502 });
  }

  const sample = extractSampleAudio(json);

  const voice = {
    id: voiceId,
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
