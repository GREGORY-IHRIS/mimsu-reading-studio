import { NextResponse } from "next/server";
import { MAX_FORMAT_CHARS, TEXT_MODEL } from "../../../../lib/shared/config.js";
import { GeminiError, callGemini } from "../../../../lib/server/gemini.js";
import { jsonError, requireApiKey, requireSession } from "../../../../lib/server/http.js";
import { userKeyFor } from "../../../../lib/server/store.js";

export const maxDuration = 60;

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
  const { session, response } = await requireSession();
  if (response) return response;
  const { apiKey, response: keyResponse } = requireApiKey();
  if (keyResponse) return keyResponse;

  const body = await request.json().catch(() => null);
  const rawText = (body?.text || "").trim();
  const castNames = Array.isArray(body?.castNames) ? body.castNames.filter(Boolean) : [];

  if (!rawText) return jsonError("정리할 글을 먼저 입력해주세요.", 400);
  if (rawText.length > MAX_FORMAT_CHARS) {
    return jsonError(`한 번에 ${MAX_FORMAT_CHARS}자까지만 정리할 수 있어요. 장면을 나눠서 넣어주세요.`, 400);
  }

  let json;
  try {
    ({ json } = await callGemini({
      path: `/models/${TEXT_MODEL}:generateContent`,
      body: {
        contents: [{ parts: [{ text: buildPrompt(rawText, castNames) }] }],
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
      },
      apiKey,
      context: {
        bucket: "text",
        purpose: "format",
        model: TEXT_MODEL,
        user: userKeyFor(session.user.email).slice(0, 8),
        details: { chars: rawText.length },
      },
      inspect: (result) => (result?.candidates?.[0]?.content?.parts?.[0]?.text
        ? {}
        : { error: "정리된 결과를 받지 못했어요." }),
    }));
  } catch (error) {
    if (!(error instanceof GeminiError)) throw error;
    return jsonError(error.message, 502, { code: error.code });
  }

  // Strip a stray markdown code fence in case the model wraps its answer in one.
  const text = json.candidates[0].content.parts[0].text
    .trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  if (!text) return jsonError("정리된 결과를 받지 못했어요.", 502);
  return NextResponse.json({ text });
}
