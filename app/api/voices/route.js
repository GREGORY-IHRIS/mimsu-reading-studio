import { NextResponse } from "next/server";
import { requireApiKey, requireSession } from "../../../lib/server/http.js";
import { getUserData } from "../../../lib/server/store.js";
import { getVoiceCatalog } from "../../../lib/server/voiceCatalog.js";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;
  const { apiKey, response: keyResponse } = requireApiKey();
  if (keyResponse) return keyResponse;

  const [sharedVoices, userData] = await Promise.all([
    getVoiceCatalog(apiKey),
    getUserData(session.user.email),
  ]);

  const custom = (userData.customVoices || []).map((v) => ({
    id: v.id,
    displayName: v.displayName,
    tag: v.tag,
    description: v.description,
    gender: v.gender,
    age: v.age,
    region: v.region,
    pitch: v.pitch,
    group: "내가 만든 목소리",
  }));

  return NextResponse.json({ voices: [...custom, ...sharedVoices] });
}
