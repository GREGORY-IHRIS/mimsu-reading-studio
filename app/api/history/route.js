import { NextResponse } from "next/server";
import { requireSession } from "../../../lib/server/http.js";
import { getUserData, libraryOf } from "../../../lib/server/store.js";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const data = await getUserData(session.user.email);
  return NextResponse.json(libraryOf(data));
}
