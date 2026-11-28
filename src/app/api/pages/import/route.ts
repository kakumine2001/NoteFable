import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { assertNoteWhiteboardsOwner } from "@/lib/note-whiteboards";
import { claimNoteFiles } from "@/lib/stored-files";
import {
  isImportableMarkdownFile,
  markdownFileToNoteContent,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_TOTAL_BYTES,
} from "@/lib/note-io";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { fmt, msg } from "@/lib/i18n/translate";

type ImportFilePayload = { name?: unknown; markdown?: unknown };

// Markdown ファイル（1 件または複数件）を取り込んでノートを作成する（Web・Android・iOS 共用）。
export async function POST(request: Request) {
  try {
    const body = await readNoteRequest(request, MAX_IMPORT_TOTAL_BYTES, msg("Import exceeds 4 MB."));
    if (!body || typeof body !== "object") {
      throw new NoteValidationError(msg("Invalid JSON request."));
    }
    const { files, groupId } = body as { files?: unknown; groupId?: unknown };
    if (!Array.isArray(files) || files.length === 0) {
      throw new NoteValidationError(msg("Select at least one Markdown file to import."));
    }
    if (files.length > MAX_IMPORT_FILES) {
      throw new NoteValidationError(fmt("You can import up to {max} files at once.", { max: MAX_IMPORT_FILES }));
    }
    if (groupId !== undefined && groupId !== null && (typeof groupId !== "string" || !groupId || groupId.length > 64)) {
      throw new NoteValidationError(msg("Project not found."), 400);
    }

    const user = await getOrCreateUser();
    const resolvedGroupId = typeof groupId === "string" ? groupId : null;
    if (resolvedGroupId) {
      const group = await prisma.noteGroup.findFirst({
        where: { id: resolvedGroupId, userId: user.id },
        select: { id: true },
      });
      if (!group) {
        return NextResponse.json({ error: msg("Project not found.") }, { status: 404 });
      }
    }

    const encoder = new TextEncoder();
    const prepared = files.map((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new NoteValidationError(msg("Only Markdown (.md, .markdown, .txt) files can be imported."));
      }
      const { name, markdown } = entry as ImportFilePayload;
      if (typeof name !== "string" || !name.trim() || typeof markdown !== "string") {
        throw new NoteValidationError(msg("Only Markdown (.md, .markdown, .txt) files can be imported."));
      }
      if (!isImportableMarkdownFile(name)) {
        throw new NoteValidationError(msg("Only Markdown (.md, .markdown, .txt) files can be imported."));
      }
      if (encoder.encode(markdown).byteLength > MAX_IMPORT_FILE_BYTES) {
        throw new NoteValidationError(msg("Note content exceeds 1 MiB."), 413);
      }
      const { content, truncated } = markdownFileToNoteContent(name, markdown);
      // ノートの上限（ブロック数・容量）に収まらないファイルは、後ろを黙って捨てずに断る。
      if (truncated) throw new NoteValidationError(fmt("File is too long for one note: {name}", { name: name.trim().slice(0, 120) }), 413);
      const validated = validateNoteContent(content);
      assertNoteFilesOwner(validated.blocks, user.id);
      return validated;
    });

    const pages = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const content of prepared) {
        await claimNoteFiles(tx, content.blocks, user.id);
        await assertNoteWhiteboardsOwner(tx, content.blocks, user.id);
        created.push(
          await tx.notePage.create({
            data: {
              userId: user.id,
              groupId: resolvedGroupId,
              title: content.title,
              icon: content.icon,
              cover: content.cover,
              coverPosition: content.coverPosition,
              blocks: content.blocks as unknown as Prisma.InputJsonValue,
            },
            select: PAGE_SUMMARY_SELECT,
          }),
        );
      }
      return created;
      // 1 MiB 近いノートを 20 件まで続けて書くので、既定の 5 秒では足りないことがある。
    }, { timeout: 30_000 });

    // 新規作成（POST /api/pages）と同じく、意味検索用の索引を作る。
    scheduleNoteEmbeddingSync(user.id, pages.map((page) => page.id));
    return NextResponse.json({ pages }, { status: 201 });
  } catch (error) {
    return noteApiError(error);
  }
}
