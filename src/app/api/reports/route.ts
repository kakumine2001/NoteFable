import { NextRequest, NextResponse } from "next/server";
import { findReportedAnswer, findReportedPage, findReportedPageImage, findReportedProposal, pageImageReportEmail, pageReportEmail, parseReport, proposalReportEmail, reportEmail, sendReport, slideImageReportEmail, whiteboardImageReportEmail } from "@/lib/answer-report";
import { readCanvasData } from "@/lib/canvas-store";
import { isImageExtension, parseNoteFileUrl } from "@/lib/note-file-keys";
import { normalizeDeck } from "@/lib/slides/model";
import { generatedImageDataOf, storedToScene } from "@/lib/whiteboard/scene";
import { getOrCreateUser, isAccountUser } from "@/lib/auth";
import { EmailSendError } from "@/lib/email-login";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";
import { clientNetworkKey, consumeReportQuota, refundUsage } from "@/lib/usage-limits";

// AI が作った内容を開発者に通報する：回答（「…」メニューの「回答を報告」）、AI の提案カード、AI が書いたページ（ページの「…」メニュー）、
// スライドの AI で作った画像（スライドの画像の設定）。
// 未ログインでも、自分のものなら送れる。ネイティブアプリの要求は Origin を付けないので通す。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: msg("Forbidden.") }, { status: 403 });
  }
  const parsed = parseReport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: msg("Could not send the report.") }, { status: 400 });

  const user = await getOrCreateUser();
  const { target, reason } = parsed.data;
  const signedIn = isAccountUser(user);
  let email: { subject: string; text: string };
  if (target.kind === "answer") {
    const answer = await findReportedAnswer(user.id, target.id);
    if (!answer) return NextResponse.json({ error: msg("This answer is no longer available.") }, { status: 404 });
    email = reportEmail({
      userId: user.id, signedIn, sessionId: answer.sessionId, messageId: answer.id,
      model: answer.model, createdAt: answer.createdAt, answer: answer.content, prompt: answer.prompt, images: answer.images, reason,
    });
  } else if (target.kind === "proposal") {
    const proposal = await findReportedProposal(user.id, target.id);
    if (!proposal) return NextResponse.json({ error: msg("This content is no longer available.") }, { status: 404 });
    email = proposalReportEmail({ userId: user.id, signedIn, proposal, reason });
  } else if (target.kind === "page") {
    const page = await findReportedPage(user.id, target.id);
    if (!page) return NextResponse.json({ error: msg("This content is no longer available.") }, { status: 404 });
    email = pageReportEmail({ userId: user.id, signedIn, page, reason });
  } else if (target.kind === "pageImage") {
    // ワークスペース（ノート・ホワイトボード・スライド）の AI 生成画像：生成時に署名したトークンと本人のページ・ファイルを確認する。
    const image = await findReportedPageImage(user.id, target.pageId, target.reportToken);
    if (!image) return NextResponse.json({ error: msg("This image is no longer available.") }, { status: 404 });
    email = pageImageReportEmail({ userId: user.id, signedIn, pageId: image.pageId, pageKind: image.pageKind, prompt: image.prompt, path: image.path, reason });
  } else {
    // スライドまたはホワイトボードの AI で作った画像：自分の（ゴミ箱に無い）ページの中の、AI で作った印のある画像だけ。
    const canvas = await readCanvasData(user.id, target.pageId);
    if (!canvas) {
      return NextResponse.json({ error: msg("This image is no longer available.") }, { status: 404 });
    }
    if (Array.isArray(canvas.elements) && canvas.slides === undefined) {
      const scene = storedToScene(canvas);
      const element = scene.elements.find((entry) => entry.id === target.elementId);
      const generated = element?.type === "image" ? generatedImageDataOf(element.customData) : null;
      const storedFile = element?.type === "image" && typeof element.fileId === "string" ? scene.files[element.fileId] : undefined;
      const file = storedFile ? parseNoteFileUrl(storedFile.dataURL) : null;
      if (!element || !generated || !file || file === "empty" || file.ownerId !== user.id || !isImageExtension(file.extension)) {
        return NextResponse.json({ error: msg("This image is no longer available.") }, { status: 404 });
      }
      email = whiteboardImageReportEmail({ userId: user.id, signedIn, pageId: target.pageId, elementId: element.id, prompt: generated.prompt, path: file.path, reason });
    } else {
      const deck = normalizeDeck(canvas);
      const element = deck.slides.flatMap((slide) => slide.elements).find((entry) => entry.id === target.elementId);
      const file = element?.type === "image" && element.generated ? parseNoteFileUrl(element.src) : null;
      if (!element || element.type !== "image" || !element.generated || !file || file === "empty" || file.ownerId !== user.id) {
        return NextResponse.json({ error: msg("This image is no longer available.") }, { status: 404 });
      }
      email = slideImageReportEmail({ userId: user.id, signedIn, pageId: target.pageId, elementId: element.id, prompt: element.generated.prompt, path: file.path, reason });
    }
  }

  const ticket = await consumeReportQuota(user, clientNetworkKey(request));
  if (!ticket) {
    return NextResponse.json({ error: msg("You’ve sent many reports today. Try again tomorrow.") }, { status: 429 });
  }

  try {
    await sendReport(email);
  } catch (error) {
    await refundUsage(ticket);
    if (error instanceof EmailSendError) return NextResponse.json({ error: msg("Could not send the report.") }, { status: 502 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
