import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../lib/authOptions";

export const maxDuration = 30;

const MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
const MAX_CHARS = 4000;

function buildPrompt(rawText, castNames) {
  return `다음은 사용자가 쓴 글입니다. 이걸 대사/나레이션이 구분된 "대본 형식"으로 바꿔주세요.

규칙:
1. 등장인물이 실제로 말한 대사(따옴표 안의 말)는 "이름: 대사" 형식으로 한 줄에 쓴다. 따옴표는 제거한다.
2. 그 외 지문, 묘사, 서술은 이름 없이 그냥 한 줄로 쓴다 (나레이션 취급됨).
3. 이미 등록된 등장인물 이름: [${castNames.join(", ") || "없음"}]. 본문에 이 이름들이 언급되면 철자를 그대로 맞춰 쓰고, 본문에서 새 인물이 분명히 말한 대사면 그 인물 이름을 새로 써도 된다.
4. 누가 말했는지 문맥상 확실하지 않으면 절대 추측하지 말고 화자 없이 나레이션 줄로 남긴다.
5. 원문의 문장과 순서, 표현을 그대로 보존한다 — 내용을 요약하거나 새로 창작하거나 문장을 바꿔쓰지 않는다. 형식(줄바꿈, "이름:" 표시)만 바꾼다.
6. 다른 설명이나 인사말 없이, 변환된 대본 텍스트만 출력한다.

원문:
${rawText}`;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버에 GEMINI_API_KEY가 없어요." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const rawText = (body?.text || "").trim();
  const castNames = Array.isArray(body?.castNames) ? body.castNames.filter(Boolean) : [];

  if (!rawText) {
    return NextResponse.json({ error: "정리할 글을 먼저 입력해주세요." }, { status: 400 });
  }
  if (rawText.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_CHARS}자까지만 정리할 수 있어요. 장면을 나눠서 넣어주세요.` },
      { status: 400 }
    );
  }

  const requestBody = {
    contents: [{ parts: [{ text: buildPrompt(rawText, castNames) }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };

  let res;
  try {
    res = await fetch(MODEL_URL, {
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
      { error: json?.error?.message || `정리에 실패했어요 (HTTP ${res.status})` },
      { status: 502 }
    );
  }

  let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  // Strip a stray markdown code fence in case the model wraps its answer in one.
  text = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();

  if (!text) {
    return NextResponse.json({ error: "정리된 결과를 받지 못했어요." }, { status: 502 });
  }

  return NextResponse.json({ text });
}
