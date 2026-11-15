import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { PAGE_FONTS, pageSummary, setPageMeta } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ページの表示設定（Notion の「…」メニュー）: { fullWidth?, smallText?, font?, locked? }。送った項目だけを変える。
// 本文の版は変えないので、編集中の自動保存と衝突しない。応答は一覧の 1 件と同じ形。
export async function PUT(request: Request, context: Context) {
  try {
    const body = await readSmallJson(request);
    const data: { fullWidth?: boolean; smallText?: boolean; locked?: boolean; font?: string } = {};
    for (const key of ["fullWidth", "smallText", "locked"] as const) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean") throw new NoteValidationError(`${key} must be a boolean.`);
      data[key] = body[key];
    }
    if (body.font !== undefined) {
      if (!PAGE_FONTS.some((font) => font === body.font)) throw new NoteValidationError(`font must be one of ${PAGE_FONTS.join(", ")}.`);
      data.font = body.font as string;
    }
    if (!Object.keys(data).length) throw new NoteValidationError("No settings to change.");
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const changed = await prisma.$transaction((tx) => setPageMeta(tx, user.id, pageId, data));
    const page = changed ? await pageSummary(user.id, pageId) : null;
    return page ? NextResponse.json({ page }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
