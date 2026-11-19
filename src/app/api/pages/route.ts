import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { createNotePage } from "@/lib/note-create";
import { NoteValidationError, readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { CHAT_RECENT_COUNT } from "@/types/notes";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser();
    if (new URL(request.url).searchParams.get("recent") === "1") {
      const pages = await prisma.notePage.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: CHAT_RECENT_COUNT,
        select: { id: true, title: true, icon: true, updatedAt: true },
      });
      return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
    }
    const [pages, groups] = await Promise.all([
      prisma.notePage.findMany({
        where: { userId: user.id, deletedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: PAGE_SUMMARY_SELECT,
      }),
      prisma.noteGroup.findMany({ where: { userId: user.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } }),
    ]);
    return NextResponse.json({ pages, groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

// 本文に加えて parentId（省略・null は最上位）を受け取る。親を指定するとそのページのサブページになる。
export async function POST(request: Request) {
  try {
    const body = await readNoteRequest(request);
    const content = validateNoteContent(body);
    const parentId = (body as { parentId?: unknown }).parentId ?? null;
    if (parentId !== null && (typeof parentId !== "string" || !parentId || parentId.length > 64)) throw new NoteValidationError("parentId must be a note ID or null.");
    const user = await getOrCreateUser();
    const page = await createNotePage(user.id, content, { parentId });
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
