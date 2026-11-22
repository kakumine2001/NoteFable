import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { readSmallJson } from "@/lib/note-groups";
import { createRevision } from "@/lib/note-revisions";
import { prisma } from "@/lib/prisma";
import { msg, fmt } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string; revisionId: string }> };

// 更新条件の版が外れた時に、履歴の追加ごとトランザクションを巻き戻す。
class Stale extends Error {}

// 履歴の状態へノートを戻す。body は { version }（画面が持つ現在の版）。
// 1 回のトランザクションで、保存済みの内容を検証し直し、いまの状態を RESTORE の履歴に残してから、タイトル・アイコン・本文を版 +1 で書く。
// カバー・カバー位置・グループは変えない。版が合わなければ PATCH と同じ形の 409（最新のページ付き）。
export async function POST(request: Request, context: Context) {
  try {
    const body = await readSmallJson(request);
    if (!Number.isSafeInteger(body.version) || (body.version as number) < 0) throw new NoteValidationError(msg("A valid note version is required."));
    const version = body.version as number;
    const user = await getOrCreateUser();
    const { pageId, revisionId } = await context.params;
    let outcome: { page: unknown } | "note-missing" | "revision-missing" | "stale";
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const current = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
        if (!current) return "note-missing" as const;
        const revision = await tx.noteRevision.findFirst({ where: { id: revisionId, noteId: pageId, userId: user.id } });
        if (!revision) return "revision-missing" as const;
        if (current.version !== version) return "stale" as const;
        // 保存時と同じ検証を、DB から読んだ履歴にもかける。
        let content;
        try {
          content = validateNoteContent({ title: revision.title, icon: revision.icon, blocks: revision.blocks });
          assertNoteFilesOwner(content.blocks, user.id);
        } catch (error) {
          if (error instanceof NoteValidationError) throw new NoteValidationError(fmt("This version cannot be restored. {detail}", { detail: error.message }), error.status);
          throw error;
        }
        await createRevision(tx, { noteId: current.id, userId: user.id, reason: "RESTORE", title: current.title, icon: current.icon, blocks: current.blocks, version: current.version });
        const changed = await tx.notePage.updateMany({
          where: { id: pageId, userId: user.id, version, deletedAt: null },
          data: { title: content.title, icon: content.icon, blocks: content.blocks as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
        });
        // 読んだ直後に別のタブが保存した：追加した履歴も取り消す。
        if (!changed.count) throw new Stale();
        const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
        if (!page) throw new Stale();
        return { page };
      });
    } catch (error) {
      if (!(error instanceof Stale)) throw error;
      outcome = "stale";
    }
    if (outcome === "note-missing") return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    if (outcome === "revision-missing") return NextResponse.json({ error: msg("Revision not found.") }, { status: 404 });
    if (outcome === "stale") {
      const latest = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
      return latest ? NextResponse.json({ error: msg("This note was changed in another tab."), page: latest }, { status: 409 }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    }
    scheduleNoteEmbeddingSync(user.id, [pageId]);
    return NextResponse.json({ page: outcome.page });
  } catch (error) { return noteApiError(error); }
}
