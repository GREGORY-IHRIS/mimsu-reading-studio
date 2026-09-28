import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { getUserData } from "../../../lib/store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const data = await getUserData(session.user.email);
  return NextResponse.json({ history: data.history });
}
