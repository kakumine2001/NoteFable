import { NextRequest, NextResponse } from "next/server";
import { findReportedAnswer, parseReport, reportEmail, sendReport, slideImageReportEmail } from "@/lib/answer-report";
import { readCanvasData } from "@/lib/canvas-store";
import { parseNoteFileUrl } from "@/lib/note-file-keys";
import { normalizeDeck } from "@/lib/slides/model";
import { getOrCreateUser, isAccountUser } from "@/lib/auth";
import { EmailSendError } from "@/lib/email-login";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";
import { clientNetworkKey, consumeReportQuota, refundUsage } from "@/lib/usage-limits";

// AI の回答を開発者に通報する（回答の「…」メニューの「回答を報告」）。未ログインでも、自分のチャットの回答なら送れる。
// ネイティブアプリの要求は Origin を付けないので通す。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: msg("Forbidden.") }, { status: 403 });
  }
  const parsed = parseReport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: msg("Could not send the report.") }, { status: 400 });

  const user = await getOrCreateUser();
  const data = parsed.data;
  let email: { subject: string; text: string };
  if ("pageId" in data) {
    // スライドの AI で作った画像：自分の（ゴミ箱に無い）スライドの中の、AI で作った印のある画像だけ。
    const deck = normalizeDeck(await readCanvasData(user.id, data.pageId));
    const element = deck.slides.flatMap((slide) => slide.elements).find((entry) => entry.id === data.elementId);
    const file = element?.type === "image" && element.generated ? parseNoteFileUrl(element.src) : null;
    if (!element || element.type !== "image" || !element.generated || !file || file === "empty") {
      return NextResponse.json({ error: msg("This image is no longer available.") }, { status: 404 });
    }
    email = slideImageReportEmail({ userId: user.id, signedIn: isAccountUser(user), pageId: data.pageId, elementId: element.id, prompt: element.generated.prompt, path: file.path, reason: data.reason });
  } else {
    const answer = await findReportedAnswer(user.id, data.messageId);
    if (!answer) return NextResponse.json({ error: msg("This answer is no longer available.") }, { status: 404 });
    email = reportEmail({
      userId: user.id, signedIn: isAccountUser(user), sessionId: answer.sessionId, messageId: answer.id,
      model: answer.model, createdAt: answer.createdAt, answer: answer.content, prompt: answer.prompt, images: answer.images, reason: data.reason,
    });
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
