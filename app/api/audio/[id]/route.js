import { requireSession } from "../../../../lib/server/http.js";
import { readAudio } from "../../../../lib/server/store.js";

export async function GET(request, { params }) {
  const { session, response } = await requireSession();
  if (response) return new Response("로그인이 필요해요.", { status: 401 });

  // The storage path is always derived from the CURRENT session's email, so
  // there is no id or parameter that lets one account read another
  // account's audio — the owner prefix isn't something a caller can supply.
  const { id } = await params;
  const audio = await readAudio(session.user.email, id);
  if (!audio) return new Response("파일을 찾을 수 없어요.", { status: 404 });

  // Blob already serves the file directly; routing long WAVs through this
  // function would hit Vercel's response-body size limit.
  if (audio.url) return Response.redirect(audio.url, 307);

  return new Response(audio.buffer, {
    headers: {
      "Content-Type": audio.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
