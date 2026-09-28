import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { concatWavBuffers } from "../../../lib/wav";
import { addHistoryEntry, saveAudio } from "../../../lib/store";
import { makeSpeechGroups, retryHintMs } from "../../../lib/scriptBatches";

const SCRIPT_MODES = new Set(["multi", "save", "record"]);

export const maxDuration = 300;

// Gemini itself accepts far more text per call than these numbers suggest
// (tested up to ~4800 chars with no rejection) — generation time and output
// size are the practical limits. A real (non-repetitive) ~1000-char Korean
// passage measured ~45s wall-clock to synthesize. Long single-voice text is
// still split into SINGLE_CHUNK_SIZE-sized pieces and generated with limited
// concurrency — see splitIntoChunks() below.
const SINGLE_CHUNK_SIZE = 1000;
const MAX_CHARS_SINGLE = 8000;
const MAX_CHARS_PER_TURN = 1000;
const MAX_CHARS_SCRIPT = 8000;
// The client sends long scripts in batches capped at 20 turns and 8 Gemini
// requests, leaving room under the 10 requests/minute quota.
const MAX_TURNS = 20;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_CONCURRENCY = 5;
const GEMINI_MAX_RETRIES = 4;
const GEMINI_RETRY_DEADLINE_MS = 270_000;

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

function buildGroupRequest(group) {
  const speakers = [...new Map(group.map((turn) => [turn.speaker, turn.voice]))];
  if (speakers.length === 1) {
    return buildSpeechRequest({
      text: group.map((turn) => turn.text).join("\n\n"),
      voice: speakers[0][1],
      style: group[0].style,
    });
  }
  return {
    model: "gemini-3.8-flash-tts",
    input: [{
      type: "user_input",
      content: group.map((turn) => ({
        type: "text",
        text: turn.text,
        annotations: [{
          type: "speech_metadata",
          speaker: turn.speaker,
          ...(turn.style ? { style: turn.style } : {}),
        }],
      })),
    }],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: {
        mode: "conversational",
        speakers: speakers.map(([speaker, voice]) => ({ speaker, voice })),
      },
    },
  };
}

async function callGemini(requestBody, apiKey, signal) {
  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch {
    if (signal?.aborted) throw new Error("음성 생성 시간이 초과됐어요. 대사를 나눠서 다시 시도해주세요.");
    throw new Error("Gemini 서버에 연결하지 못했어요.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }

  const audio = extractAudio(json);
  if (!audio) throw new Error("음성 데이터를 받지 못했어요.");
  return audio;
}

async function callGeminiWithRetry(requestBody, apiKey, deadline) {
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("음성 생성 시간이 초과됐어요. 대사를 나눠서 다시 시도해주세요.");
    try {
      return await callGemini(requestBody, apiKey, AbortSignal.timeout(remaining));
    } catch (error) {
      if (error.status !== 429 || attempt >= GEMINI_MAX_RETRIES) throw error;

      const delay = retryHintMs(error.message) ?? 1000 * 2 ** attempt;
      if (!Number.isFinite(delay) || delay < 0 || Date.now() + delay >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(GEMINI_CONCURRENCY, items.length) }, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    })
  );
  return results;
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
  const deadline = Date.now() + GEMINI_RETRY_DEADLINE_MS;
  if (chunks.length === 1) {
    const audio = await callGeminiWithRetry(buildSpeechRequest({ text: chunks[0], voice, style }), apiKey, deadline);
    return { audio };
  }

  let clips;
  try {
    clips = await mapWithConcurrency(
      chunks,
      (chunk) => callGeminiWithRetry(buildSpeechRequest({ text: chunk, voice, style }), apiKey, deadline)
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

  // Group adjacent lines into single-speaker passages or two-speaker
  // conversations. Custom voices and groups of 3+ speakers remain separate.
  const groups = makeSpeechGroups(turns);
  let nextLine = 0;
  const indexedGroups = groups.map((group) => {
    const start = nextLine;
    nextLine += group.length;
    return { group, start, end: nextLine - 1 };
  });
  const deadline = Date.now() + GEMINI_RETRY_DEADLINE_MS;
  let clips;
  try {
    clips = await mapWithConcurrency(
      indexedGroups,
      async ({ group, start, end }) => {
        try {
          try {
            return await callGeminiWithRetry(buildGroupRequest(group), apiKey, deadline);
          } catch (error) {
            if (group.length < 2 || error.status !== 400) throw error;
            // If Gemini rejects a grouped voice combination, preserve the
            // old per-line path so this script can still finish.
            const individual = [];
            for (const turn of group) {
              individual.push(await callGeminiWithRetry(buildSpeechRequest(turn), apiKey, deadline));
            }
            const joined = concatWavBuffers(individual.map((clip) => Buffer.from(clip.base64, "base64")), 250);
            return { base64: joined.toString("base64"), mimeType: "audio/wav" };
          }
        } catch (e) {
          const place = start === end ? `${start + 1}번째 줄(${group[0].speaker})` : `${start + 1}~${end + 1}번째 줄`;
          const error = new Error(`${place} 생성 실패: ${e.message}`);
          error.status = e.status;
          throw error;
        }
      }
    );
  } catch (e) {
    return { error: e.message, status: e.status };
  }

  const buffers = clips.map((c) => Buffer.from(c.base64, "base64"));
  const combined = concatWavBuffers(buffers, 250);
  return { audio: { base64: combined.toString("base64"), mimeType: "audio/wav" } };
}

// Saves audio that the client already produced in full (e.g. batches of a
// long script stitched together locally — see lib/wavClient.js) instead of
// generating or re-combining anything server-side.
function handleSave(body) {
  const base64 = body?.audioBase64;
  if (!base64) return { error: "저장할 음성 데이터가 없어요." };
  return { audio: { base64, mimeType: body.mimeType || "audio/wav" } };
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

  // The audio for "record" already lives in Blob storage (uploaded straight
  // from the browser) — just write the history entry, no audio to touch.
  if (body.mode === "record") {
    if (!body.id) return NextResponse.json({ error: "저장할 음성 정보가 없어요." }, { status: 400 });
    try {
      const history = await addHistoryEntry(session.user.email, buildEntry(body.id, body, body.mimeType || "audio/wav"));
      return NextResponse.json({ entry: history.find((h) => h.id === body.id), history });
    } catch (e) {
      return NextResponse.json(
        { error: `기록 저장에 실패했어요: ${e.message || "알 수 없는 오류"}` },
        { status: 502 }
      );
    }
  }

  let result;
  try {
    if (body.mode === "save") {
      result = handleSave(body);
    } else if (body.mode === "multi") {
      result = await handleMulti(body, apiKey);
    } else {
      result = await handleSingle(body, apiKey);
    }
  } catch (e) {
    return NextResponse.json({ error: e.message || "알 수 없는 오류가 발생했어요." }, { status: 502 });
  }

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status === 429 ? 429 : 400 });
  }

  // Previews (voice try-outs in the cast manager) are throwaway — just hand
  // back the audio inline instead of cluttering the user's saved history.
  if (body.preview) return streamPreview(result.audio);

  const email = session.user.email;
  const id = crypto.randomUUID();
  const buffer = Buffer.from(result.audio.base64, "base64");

  try {
    await saveAudio(email, id, buffer, result.audio.mimeType);
    const entry = buildEntry(id, body, result.audio.mimeType);
    const history = await addHistoryEntry(email, entry);

    return NextResponse.json({ entry, history });
  } catch (e) {
    return NextResponse.json(
      { error: `음성은 만들어졌지만 저장에 실패했어요: ${e.message || "알 수 없는 오류"}` },
      { status: 502 }
    );
  }
}

function streamPreview(audio) {
  const json = JSON.stringify({ audioBase64: audio.base64, mimeType: audio.mimeType });
  const encoder = new TextEncoder();
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= json.length) return controller.close();
      controller.enqueue(encoder.encode(json.slice(offset, offset + 64 * 1024)));
      offset += 64 * 1024;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function buildEntry(id, body, mimeType) {
  return {
    id,
    label: SCRIPT_MODES.has(body.mode) ? `대본 · 등장인물 ${new Set((body.turns || []).map((t) => t.speaker)).size}명` : `${body.voice}${body.style ? ` · ${body.style}` : ""}`,
    snippet: buildSnippet(body),
    createdAt: new Date().toISOString(),
    mimeType,
    name: null,
    pinned: false,
    folder: null,
  };
}

function buildSnippet(body) {
  const raw = SCRIPT_MODES.has(body.mode) ? (body.turns || []).map((t) => t.text).join(" ") : body.text || "";
  const trimmed = raw.trim();
  return trimmed.slice(0, 40) + (trimmed.length > 40 ? "…" : "");
}
