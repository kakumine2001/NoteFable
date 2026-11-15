import { NextRequest, NextResponse } from "next/server";
import { consumeReport, findReportedAnswer, parseReport, reportEmail, sendReport } from "@/lib/answer-report";
import { getOrCreateUser, isAccountUser } from "@/lib/auth";
import { EmailSendError } from "@/lib/email-login";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";

// AI の回答を開発者に通報する（回答の「…」メニューの「回答を報告」）。未ログインでも、自分のチャットの回答なら送れる。
// 原生アプリの要求は Origin を付けないので通す。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const parsed = parseReport(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: msg("Could not send the report.") }, { status: 400 });

  const user = await getOrCreateUser();
  const answer = await findReportedAnswer(user.id, parsed.data.messageId);
  if (!answer) return NextResponse.json({ error: msg("This answer is no longer available.") }, { status: 404 });

  if (!(await consumeReport(user.id))) {
    return NextResponse.json({ error: msg("You’ve sent many reports today. Try again tomorrow.") }, { status: 429 });
  }

  try {
    await sendReport(reportEmail({
      userId: user.id, signedIn: isAccountUser(user), sessionId: answer.sessionId, messageId: answer.id,
      model: answer.model, createdAt: answer.createdAt, answer: answer.content, prompt: answer.prompt, reason: parsed.data.reason,
    }));
  } catch (error) {
    if (error instanceof EmailSendError) return NextResponse.json({ error: msg("Could not send the report.") }, { status: 502 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
