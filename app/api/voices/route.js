import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { getVoiceCatalog } from "../../../lib/voiceCatalog";
import { getUserData } from "../../../lib/store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버에 GEMINI_API_KEY가 없어요." }, { status: 500 });
  }

  const [sharedVoices, userData] = await Promise.all([
    getVoiceCatalog(apiKey),
    getUserData(session.user.email),
  ]);

  const custom = (userData.customVoices || []).map((v) => ({
    id: v.id,
    displayName: v.displayName,
    tag: v.tag,
    group: "내가 만든 목소리",
  }));

  return NextResponse.json({ voices: [...custom, ...sharedVoices] });
}
