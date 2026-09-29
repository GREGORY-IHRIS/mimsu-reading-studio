import { NextResponse } from "next/server";
import { jsonError, requireSession } from "../../../lib/server/http.js";
import { createFolder, removeFolder, renameFolder } from "../../../lib/server/store.js";

const MAX_FOLDER = 40;

const cleanName = (value) => (typeof value === "string" ? value.trim().slice(0, MAX_FOLDER) : "");

async function withBody(request, handle) {
  const { session, response } = await requireSession();
  if (response) return response;
  const body = await request.json().catch(() => null);
  if (!body) return jsonError("요청 형식이 올바르지 않아요.", 400);
  return NextResponse.json(await handle(session.user.email, body));
}

// { name } → new (possibly empty) folder
export function POST(request) {
  return withBody(request, async (email, body) => {
    const name = cleanName(body.name);
    if (!name) throw new Error("폴더 이름을 입력해주세요.");
    return createFolder(email, name);
  }).catch((e) => jsonError(e.message, 400));
}

// { from, to } → rename (merges into an existing folder of that name)
export function PATCH(request) {
  return withBody(request, async (email, body) => {
    const from = cleanName(body.from);
    const to = cleanName(body.to);
    if (!from || !to) throw new Error("폴더 이름을 입력해주세요.");
    return renameFolder(email, from, to);
  }).catch((e) => jsonError(e.message, 400));
}

// { name } → delete the folder; its recordings move back to "전체"
export function DELETE(request) {
  return withBody(request, async (email, body) => removeFolder(email, cleanName(body.name)))
    .catch((e) => jsonError(e.message, 400));
}
