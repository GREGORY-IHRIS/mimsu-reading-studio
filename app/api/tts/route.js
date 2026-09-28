import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { concatWavBuffers } from "../../../lib/wav";
import { addHistoryEntry, saveAudio } from "../../../lib/store";

export const maxDuration = 60;

// Gemini itself accepts far more text per call than these numbers suggest
// (tested up to ~4800 chars with no rejection) — the real ceiling is our own
// Vercel function's 60s timeout below. A real (non-repetitive) ~1000-char
// Korean passage measured ~45s wall-clock to synthesize, so anything much
// longer than that in a single call risks timing out mid-request. Rather
// than cap total length tightly, long single-voice text is split into
// SINGLE_CHUNK_SIZE-sized pieces and generated in parallel, the same trick
// handleMulti already uses per script line — see splitIntoChunks() below.
const SINGLE_CHUNK_SIZE = 1000;
const MAX_CHARS_SINGLE = 8000;
const MAX_CHARS_PER_TURN = 1000;
const MAX_CHARS_SCRIPT = 8000;
const MAX_TURNS = 60;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Splits long text on paragraph breaks first, falling back to sentence
// breaks for any paragraph that's still too long on its own.
function splitIntoChunks(text, maxChars) {
  if (text.length <= maxChars) return [text];

  const parts = text.split(/\n{2,}/).flatMap((para) => {
    const trimmed = para.trim();
    return trimmed.length <= maxChars ? [trimmed] : trimmed.split(/(?<=[.?!다요])\s+/);
  });

  const chunks = [];
  let current = "";
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = piece.length <= maxChars ? piece : piece.slice(0, maxChars);
  }
  if (current) chunks.push(current);
  return chunks;
}

function extractAudio(json) {
  // Documented shape: steps[] where type === "model_output", each with a
  // content[] array; the audio entry has type "audio" and a base64 `data`.
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  const modelOutputs = steps.filter((s) => s?.type === "model_output");
  for (let i = modelOutputs.length - 1; i >= 0; i--) {
    const content = Array.isArray(modelOutputs[i]?.content) ? modelOutputs[i].content : [];
    const audioPart = content.find((c) => c?.type === "audio" && c?.data);
    if (audioPart) {
      return {
        base64: audioPart.data,
        mimeType: audioPart.mime_type || audioPart.mimeType || "audio/wav",
      };
    }
  }

  // Fallback: recursively search for any {data, mime_type} pair that looks
  // like audio, in case the exact shape shifts (this API is very new).
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

function buildSpeechRequest({ text, voice, style }) {
  return {
    model: "gemini-3.8-flash-tts",
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text,
            annotations: style ? [{ type: "speech_metadata", style }] : [],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  };
}

async function callGemini(requestBody, apiKey) {
  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new Error("Gemini 서버에 연결하지 못했어요.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }

  const audio = extractAudio(json);
  if (!audio) throw new Error("음성 데이터를 받지 못했어요.");
  return audio;
}

async function handleSingle(body, apiKey) {
  const text = (body?.text || "").trim();
  const voice = body?.voice || "Sulafat";
  const style = (body?.style || "").trim();

  if (!text) return { error: "읽을 글을 입력해주세요." };
  if (text.length > MAX_CHARS_SINGLE) {
    return { error: `한 번에 ${MAX_CHARS_SINGLE}자까지만 가능해요. 장면을 나눠서 보내주세요.` };
  }

  const chunks = splitIntoChunks(text, SINGLE_CHUNK_SIZE);
  if (chunks.length === 1) {
    const audio = await callGemini(buildSpeechRequest({ text: chunks[0], voice, style }), apiKey);
    return { audio };
  }

  let clips;
  try {
    clips = await Promise.all(
      chunks.map((chunk) => callGemini(buildSpeechRequest({ text: chunk, voice, style }), apiKey))
    );
  } catch (e) {
    return { error: e.message };
  }

  const buffers = clips.map((c) => Buffer.from(c.base64, "base64"));
  const combined = concatWavBuffers(buffers, 150);
  return { audio: { base64: combined.toString("base64"), mimeType: "audio/wav" } };
}

async function handleMulti(body, apiKey) {
  const turns = Array.isArray(body?.turns) ? body.turns : [];
  if (turns.length === 0) return { error: "대본에 읽을 대사가 없어요." };
  if (turns.length > MAX_TURNS) {
    return { error: `한 번에 대사 ${MAX_TURNS}줄까지만 가능해요. 장면을 나눠서 보내주세요.` };
  }

  const totalChars = turns.reduce((sum, t) => sum + (t.text || "").length, 0);
  if (totalChars > MAX_CHARS_SCRIPT) {
    return { error: `한 번에 ${MAX_CHARS_SCRIPT}자까지만 가능해요. 장면을 나눠서 보내주세요.` };
  }
  for (const t of turns) {
    if (!t.speaker || !t.voice || !t.text) {
      return { error: "대본에 화자·목소리·대사가 빠진 줄이 있어요." };
    }
    if (t.text.length > MAX_CHARS_PER_TURN) {
      return { error: `"${t.speaker}"의 한 대사가 너무 길어요 (${MAX_CHARS_PER_TURN}자 이하로 나눠주세요).` };
    }
  }

  // Gemini's native multi-speaker ("conversational") mode caps out at 2
  // speakers per call — undocumented, found by testing; 3+ returns a plain
  // 400 "Invalid input received." A narrator + 2 characters already breaks
  // that, so instead each line is generated with its own single-speaker call
  // (in parallel) and the resulting WAV clips are stitched together below.
  let clips;
  try {
    clips = await Promise.all(
      turns.map(async (t, i) => {
        try {
          return await callGemini(
            buildSpeechRequest({ text: t.text, voice: t.voice, style: t.style }),
            apiKey
          );
        } catch (e) {
          throw new Error(`${i + 1}번째 줄(${t.speaker}) 생성 실패: ${e.message}`);
        }
      })
    );
  } catch (e) {
    return { error: e.message };
  }

  const buffers = clips.map((c) => Buffer.from(c.base64, "base64"));
  const combined = concatWavBuffers(buffers, 250);
  return { audio: { base64: combined.toString("base64"), mimeType: "audio/wav" } };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 GEMINI_API_KEY가 설정되어 있지 않아요. 관리자에게 알려주세요." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  let result;
  try {
    result = body.mode === "multi" ? await handleMulti(body, apiKey) : await handleSingle(body, apiKey);
  } catch (e) {
    return NextResponse.json({ error: e.message || "알 수 없는 오류가 발생했어요." }, { status: 502 });
  }

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Previews (voice try-outs in the cast manager) are throwaway — just hand
  // back the audio inline instead of cluttering the user's saved history.
  if (body.preview) {
    return NextResponse.json({ audioBase64: result.audio.base64, mimeType: result.audio.mimeType });
  }

  const email = session.user.email;
  const id = crypto.randomUUID();
  const buffer = Buffer.from(result.audio.base64, "base64");

  try {
    await saveAudio(email, id, buffer, result.audio.mimeType);

    const entry = {
      id,
      label: body.mode === "multi" ? `대본 · 등장인물 ${new Set(body.turns.map((t) => t.speaker)).size}명` : `${body.voice}${body.style ? ` · ${body.style}` : ""}`,
      snippet: buildSnippet(body),
      createdAt: new Date().toISOString(),
      mimeType: result.audio.mimeType,
    };
    const history = await addHistoryEntry(email, entry);

    return NextResponse.json({ entry, history });
  } catch (e) {
    return NextResponse.json(
      { error: `음성은 만들어졌지만 저장에 실패했어요: ${e.message || "알 수 없는 오류"}` },
      { status: 502 }
    );
  }
}

function buildSnippet(body) {
  const raw = body.mode === "multi" ? body.turns.map((t) => t.text).join(" ") : body.text || "";
  const trimmed = raw.trim();
  return trimmed.slice(0, 40) + (trimmed.length > 40 ? "…" : "");
}
