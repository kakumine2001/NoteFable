import { NextRequest, NextResponse } from "next/server";
import { findReportedAnswer, findReportedPage, findReportedProposal, pageReportEmail, parseReport, proposalReportEmail, reportEmail, sendReport } from "@/lib/answer-report";
import { getOrCreateUser, isAccountUser } from "@/lib/auth";
import { EmailSendError } from "@/lib/email-login";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";
import { clientNetworkKey, consumeReportQuota, refundUsage } from "@/lib/usage-limits";

// AI が作った内容を開発者に通報する：回答（「…」メニューの「回答を報告」）、AI の提案カード、AI が書いたページ（ページの「…」メニュー）。
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
  } else {
    const page = await findReportedPage(user.id, target.id);
    if (!page) return NextResponse.json({ error: msg("This content is no longer available.") }, { status: 404 });
    email = pageReportEmail({ userId: user.id, signedIn, page, reason });
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
