import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { getUserData, saveCast } from "../../../lib/store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const data = await getUserData(session.user.email);
  return NextResponse.json({ cast: data.cast });
}

export async function PUT(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cast)) {
    return NextResponse.json({ error: "형식이 올바르지 않아요." }, { status: 400 });
  }

  await saveCast(session.user.email, body.cast);
  return NextResponse.json({ ok: true });
}
