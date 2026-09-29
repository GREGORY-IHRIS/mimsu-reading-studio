import { handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/server/authOptions.js";
import { usingBlob, userKeyFor } from "../../../lib/server/store.js";

// Lets the browser upload an already-finished audio file straight to Vercel
// Blob, so its size is never bounded by a serverless function's request/
// response body limit (4.5MB) the way routing it through /api/tts would be.
// See lib/client/api.js's saveFinishedAudio() for the client side of this.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  if (!usingBlob()) return NextResponse.json({ available: false });
  const key = userKeyFor(session.user.email);
  return NextResponse.json({ available: true, prefix: `users/${key}/audio/` });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const key = userKeyFor(session.user.email);
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`users/${key}/audio/`)) {
          throw new Error("허용되지 않은 경로예요.");
        }
        return {
          allowedContentTypes: ["audio/wav", "audio/mpeg"],
          addRandomSuffix: false,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error.message || "업로드 토큰 발급에 실패했어요." }, { status: 400 });
  }
}
