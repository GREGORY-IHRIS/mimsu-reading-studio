import { NextResponse } from "next/server";
import { jsonError, requireSession } from "../../../lib/server/http.js";
import { getUserData, saveCast } from "../../../lib/server/store.js";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const data = await getUserData(session.user.email);
  return NextResponse.json({ cast: data.cast });
}

export async function PUT(request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cast)) return jsonError("형식이 올바르지 않아요.", 400);

  await saveCast(session.user.email, body.cast);
  return NextResponse.json({ ok: true });
}
