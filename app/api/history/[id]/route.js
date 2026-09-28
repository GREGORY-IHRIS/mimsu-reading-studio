import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../lib/authOptions";
import { deleteHistoryEntry, updateHistoryEntry } from "../../../../lib/store";

const MAX_NAME = 60;
const MAX_FOLDER = 40;

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  const patch = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, MAX_NAME);
    patch.name = name || null;
  }
  if (typeof body.pinned === "boolean") {
    patch.pinned = body.pinned;
  }
  if (typeof body.folder === "string" || body.folder === null) {
    const folder = typeof body.folder === "string" ? body.folder.trim().slice(0, MAX_FOLDER) : null;
    patch.folder = folder || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "바꿀 내용이 없어요." }, { status: 400 });
  }

  const history = await updateHistoryEntry(session.user.email, params.id, patch);
  return NextResponse.json({ history });
}

export async function DELETE(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const history = await deleteHistoryEntry(session.user.email, params.id);
  return NextResponse.json({ history });
}
