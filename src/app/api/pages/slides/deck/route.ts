import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { validateCanvasPage } from "@/lib/canvas-document";
import { readCanvasData } from "@/lib/canvas-store";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { createCanvasPage } from "@/lib/note-create";
import { MAX_NOTE_TITLE, NoteValidationError } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { isRecordId } from "@/lib/page-ai/ids";
import { aiRequestPageId, findRequestedPage, isDuplicateCreate } from "@/lib/page-ai/one-shot";
import { prisma } from "@/lib/prisma";
import { buildAiDeck, pendingSlideImageTasks } from "@/lib/slides/ai-build";
import { deckInput, deckInstructions, parseDeckReply } from "@/lib/slides/ai-prompt";
import { generateSlidesText, readSlidesMaterial, readSlidesRequest, SLIDES_FAILED, slidesModel } from "@/lib/slides/ai-server";
import { parseOutline } from "@/lib/slides/ai-wizard";
import { normalizeDeck } from "@/lib/slides/model";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 全部のスライドを書く 1 回の生成を待つ。上流の要求は PAGE_TIMEOUT_MS で先に打ち切る。
export const maxDuration = 300;

// 29 枚分の本文と演説者ノート（推論を含む）。モデルの上限がこれより小さければそちらに合わせる。
const MAX_DECK_OUTPUT_TOKENS = 32_000;

function summary<T extends Record<string, unknown>>(page: T) {
  return Object.fromEntries(Object.keys(PAGE_SUMMARY_SELECT).map((key) => [key, page[key]]));
}

// 省略（undefined / null）は null。ID の形でなければ undefined。
function placement(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isRecordId(value) ? value : undefined;
}

// 確かめた大綱から AI が全部のスライドを書き、1 つのスライドのページとして保存する（docs/architecture/slides.md の「AI 生成幻灯片」）。
// body: { source, options, outline, model?, clientRequestId, groupId?, parentId? }
// → 201 { page, partial? }（partial: 材料を上限で切った・枚数の上限で一部を落とした）
//   同じ clientRequestId で既に作ってあれば 200 { page }（生成も数え直しもしない）。
// 作る場所は parentId、なければノート 1 つから作るときはそのノートの下、なければ groupId のプロジェクト、どれもなければ最上位。
// 送信 1 回分（chat）として数え、作れなかったときは戻す。
export async function POST(request: Request) {
  const parsed = await readSlidesRequest(request);
  if (parsed instanceof Response) return parsed;
  const { body, source, options, clientRequestId } = parsed;
  const outline = parseOutline(body.outline);
  const parentId = placement(body.parentId);
  const groupId = placement(body.groupId);
  if (!outline || parentId === undefined || groupId === undefined) return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });

  let ticket: UsageTicket | undefined;
  try {
    const user = await getOrCreateUser();
    const generateImages = options.generateImages === true;
    const pageId = aiRequestPageId(user.id, "slides", clientRequestId);
    // 同じ要求の送り直し（応答だけが失われたなど）：作ってあるページを返す。
    const existing = await findRequestedPage(user.id, pageId);
    if (existing) return await replayed(existing, user.id, generateImages);

    const material = await readSlidesMaterial(user.id, source);
    if (material instanceof Response) return material;
    // 作り先（親ページ・プロジェクト）が本人所有で存在することを課金・生成の前に確かめる。
    // 単一ノート由来の暗黙の親は readSlidesMaterial で確認済み。同時削除への防御は createCanvasPage のトランザクション内でも行う。
    const effectiveParentId = parentId ?? (source.type === "notes" && source.pageIds.length === 1 ? source.pageIds[0] : null);
    if (parentId) {
      const parent = await prisma.notePage.findFirst({ where: { id: parentId, userId: user.id, deletedAt: null }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    } else if (!effectiveParentId && groupId) {
      const group = await prisma.noteGroup.findFirst({ where: { id: groupId, userId: user.id }, select: { id: true } });
      if (!group) return NextResponse.json({ error: msg("Project not found.") }, { status: 404 });
    }
    const model = slidesModel(body.model);

    const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "chat");
    ticket = usage.ticket;

    const reply = await generateSlidesText({
      model,
      instructions: deckInstructions(source.type, generateImages),
      input: deckInput(material.text, outline, options, source.type),
      userId: user.id,
      request,
      maxOutputTokens: MAX_DECK_OUTPUT_TOKENS,
    });
    const slides = reply === null ? null : parseDeckReply(reply, outline, { generateImages });
    if (!slides) {
      if (reply !== null) console.error("The slides reply did not follow the format");
      await refundUsage(ticket);
      return NextResponse.json({ error: SLIDES_FAILED }, { status: 502 });
    }

    const { deck, truncatedSlides } = buildAiDeck({ title: outline.title, slides, theme: options.theme });
    const imageTasks = generateImages ? pendingSlideImageTasks(deck) : [];
    const input = validateCanvasPage("slides", { title: outline.title.slice(0, MAX_NOTE_TITLE), icon: null, data: deck });
    let page;
    try {
      ({ page } = await createCanvasPage(user.id, "slides", input, {
        parentId: effectiveParentId,
        groupId,
        ai: true,
        id: pageId,
      }));
    } catch (error) {
      // 同じ要求が同時に届き、先に作られていた：数えた分を戻して、そのページを返す。
      if (!isDuplicateCreate(error)) throw error;
      await refundUsage(ticket);
      ticket = undefined;
      const created = await findRequestedPage(user.id, pageId);
      if (created) return await replayed(created, user.id, generateImages);
      throw error;
    }
    scheduleNoteEmbeddingSync(user.id, [page.id]);
    return NextResponse.json({
      page: summary(page),
      ...(material.truncated || truncatedSlides ? { partial: true } : {}),
      ...(imageTasks.length ? { imageTasks } : {}),
    }, { status: 201 });
  } catch (error) {
    await refundUsage(ticket);
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("Slides request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: SLIDES_FAILED }, { status: 503 });
  }
}

async function replayed(page: NonNullable<Awaited<ReturnType<typeof findRequestedPage>>>, userId: string, generateImages: boolean) {
  if (page.deletedAt) return NextResponse.json({ error: msg("These slides were moved to the trash.") }, { status: 404 });
  const data = generateImages ? await readCanvasData(userId, page.id) : null;
  const imageTasks = data ? pendingSlideImageTasks(normalizeDeck(data)) : [];
  return NextResponse.json({ page: summary(page), ...(imageTasks.length ? { imageTasks } : {}) }, { status: 200 });
}
