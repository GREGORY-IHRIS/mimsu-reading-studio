import { NextResponse } from "next/server";
import { jsonError, requireSession } from "../../../../lib/server/http.js";
import { deleteHistoryEntry, updateHistoryEntry } from "../../../../lib/server/store.js";

const MAX_NAME = 60;
const MAX_FOLDER = 40;

export async function PATCH(request, { params }) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (!body) return jsonError("요청 형식이 올바르지 않아요.", 400);

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

  if (Object.keys(patch).length === 0) return jsonError("바꿀 내용이 없어요.", 400);

  const { id } = await params;
  const library = await updateHistoryEntry(session.user.email, id, patch);
  return NextResponse.json(library);
}

export async function DELETE(_request, { params }) {
  const { session, response } = await requireSession();
  if (response) return response;

  const { id } = await params;
  const library = await deleteHistoryEntry(session.user.email, id);
  return NextResponse.json(library);
}
