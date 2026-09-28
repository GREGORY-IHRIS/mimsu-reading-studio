import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../lib/authOptions";
import { readAudio } from "../../../../lib/store";

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("로그인이 필요해요.", { status: 401 });

  // The storage path is always derived from the CURRENT session's email, so
  // there is no id or parameter that lets one account read another
  // account's audio — the owner prefix isn't something a caller can supply.
  const audio = await readAudio(session.user.email, params.id);
  if (!audio) return new Response("파일을 찾을 수 없어요.", { status: 404 });

  return new Response(audio.buffer, {
    headers: {
      "Content-Type": audio.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
