import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./authOptions.js";

// Small helpers so every API route answers errors the same way.

export function jsonError(error, status, extra = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

// Usage: const { session, response } = await requireSession(); if (response) return response;
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) return { response: jsonError("로그인이 필요해요.", 401) };
  return { session };
}

export function requireApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { response: jsonError("서버에 GEMINI_API_KEY가 설정되어 있지 않아요. 관리자에게 알려주세요.", 500) };
  }
  return { apiKey };
}

// Sends a large JSON payload (base64 audio) as a stream. Streamed responses
// are not subject to the ~4.5 MB cap on ordinary serverless responses.
export function streamJson(payload) {
  const json = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const CHUNK = 64 * 1024;
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= json.length) return controller.close();
      controller.enqueue(encoder.encode(json.slice(offset, offset + CHUNK)));
      offset += CHUNK;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
