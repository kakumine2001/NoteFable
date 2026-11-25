import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import {
  generateShareToken,
  resolveOwnerShareState,
  sharedPageSummary,
  shareOriginForRequest,
  updatePageShareMeta,
  type ShareMetaUpdate,
} from "@/lib/note-share-server";
import { NOTE_ONLY_ACTION_ERRORS, pageKindRejection } from "@/lib/page-kind-errors";
import { pageKindFeatures, pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

export const runtime = "nodejs";

type Params = { params: Promise<{ pageId: string }> };

// 所有者向け: このページの公開共有状態（親からの継承を含む）を返す。
export async function GET(request: Request, { params }: Params) {
  try {
    const { pageId } = await params;
    const user = await getOrCreateUser();
    const share = await resolveOwnerShareState(user.id, pageId, shareOriginForRequest(request));
    if (!share) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    return NextResponse.json({ share }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteApiError(error);
  }
}

// 所有者向け: 公開のオン・オフ、サブページを含むか、有効期限、親の共有からの除外を保存する。
// 公開用の読み取りビューが無い種類は公開できない（PAGE_KIND_FEATURES の publicShare。いまはノート・ホワイトボード・スライドのすべてが公開できる）。
export async function PUT(request: Request, { params }: Params) {
  try {
    const { pageId } = await params;
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: msg("Invalid request body.") }, { status: 400 });
    }

    const user = await getOrCreateUser();
    const existing = await prisma.notePage.findFirst({
      where: { id: pageId, userId: user.id, deletedAt: null },
      select: { id: true, kind: true, shareToken: true, shareEnabled: true, shareExpiresAt: true },
    });
    if (!existing) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    const kind = pageKindOf(existing);
    if (body.enabled === true && !pageKindFeatures(kind).publicShare) return pageKindRejection(request, NOTE_ONLY_ACTION_ERRORS.share, kind);

    const now = new Date();
    const update: ShareMetaUpdate = {};

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") return NextResponse.json({ error: msg("Invalid share settings.") }, { status: 400 });
      update.shareEnabled = body.enabled;
      if (body.enabled && !existing.shareToken) update.ensureToken = generateShareToken();
    }

    if ("includeSubpages" in body) {
      if (typeof body.includeSubpages !== "boolean") return NextResponse.json({ error: msg("Invalid share settings.") }, { status: 400 });
      update.shareIncludeSubpages = body.includeSubpages;
    }

    if ("excludeFromParent" in body) {
      if (typeof body.excludeFromParent !== "boolean") return NextResponse.json({ error: msg("Invalid share settings.") }, { status: 400 });
      update.shareExcludeFromParent = body.excludeFromParent;
    }

    if ("expiresAt" in body) {
      if (body.expiresAt === null) {
        update.shareExpiresAt = null;
      } else if (typeof body.expiresAt === "string") {
        const parsed = new Date(body.expiresAt);
        if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
          return NextResponse.json({ error: msg("Expiration time must be in the future.") }, { status: 400 });
        }
        update.shareExpiresAt = parsed;
      } else {
        return NextResponse.json({ error: msg("Invalid share settings.") }, { status: 400 });
      }
    } else if (update.shareEnabled === true && existing.shareExpiresAt && existing.shareExpiresAt.getTime() <= now.getTime()) {
      // 期限切れのリンクを再公開したときは、古い期限を消してすぐ見られるようにする。
      update.shareExpiresAt = null;
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: msg("Invalid share settings.") }, { status: 400 });
    }

    const updated = await updatePageShareMeta(user.id, pageId, update);
    if (!updated) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });

    const [share, page] = await Promise.all([
      resolveOwnerShareState(user.id, pageId, shareOriginForRequest(request)),
      sharedPageSummary(user.id, pageId),
    ]);
    if (!share || !page) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    return NextResponse.json({ share, page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteApiError(error);
  }
}
