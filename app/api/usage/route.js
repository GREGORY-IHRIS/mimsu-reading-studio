import { NextResponse } from "next/server";
import { jsonError, requireSession } from "../../../lib/server/http.js";
import { userKeyFor } from "../../../lib/server/store.js";
import { adjustUsage, exportUsage, getUsageOverview } from "../../../lib/server/usageLog.js";

// GET  /api/usage?days=14        today's numbers + per-day history (usage panel, pre-flight check)
// GET  /api/usage?export=json    every logged entry, as a download (see docs/USAGE_LOG.md)
// GET  /api/usage?export=csv     the same, as a spreadsheet
// POST /api/usage {used: n}      manual correction of today's count

const CSV_COLUMNS = [
  "ts", "type", "bucket", "purpose", "outcome", "http", "ms", "chars", "lines", "speakers",
  "audioKB", "job", "user", "error",
];

function csvCell(value) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(files) {
  const rows = files.flatMap((file) => file.events);
  const lines = rows.map((event) => CSV_COLUMNS.map((column) => csvCell(event[column])).join(","));
  return `﻿${[CSV_COLUMNS.join(","), ...lines].join("\n")}\n`;
}

function download(body, contentType, filename) {
  return new Response(body, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request) {
  const { response } = await requireSession();
  if (response) return response;

  const params = new URL(request.url).searchParams;
  const format = params.get("export");
  if (format) {
    const files = await exportUsage();
    const stamp = new Date().toISOString().slice(0, 10);
    return format === "csv"
      ? download(toCsv(files), "text/csv", `gemini-usage-${stamp}.csv`)
      : download(JSON.stringify({ exportedAt: new Date().toISOString(), days: files }, null, 1), "application/json", `gemini-usage-${stamp}.json`);
  }

  const days = Math.min(Math.max(Number.parseInt(params.get("days"), 10) || 14, 1), 60);
  return NextResponse.json(await getUsageOverview({ days }), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const used = Number.parseInt(body?.used, 10);
  if (!Number.isInteger(used) || used < 0 || used > 100_000) {
    return jsonError("0 이상의 숫자를 입력해주세요.", 400);
  }

  const { error } = await adjustUsage(used, userKeyFor(session.user.email).slice(0, 8));
  if (error) return jsonError(`사용량을 저장하지 못했어요: ${error}`, 502);
  return NextResponse.json(await getUsageOverview({ days: 1 }));
}
