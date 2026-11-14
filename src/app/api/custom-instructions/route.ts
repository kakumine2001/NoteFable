import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { validCustomInstructions } from "@/lib/custom-instructions";
import { msg } from "@/lib/i18n/translate";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

function failure(error: unknown, fallback: string) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Custom instructions request failed", error);
  return NextResponse.json({ error: fallback }, { status: 503 });
}

// カスタム指示はログインした利用者の設定。getOrCreateAnonymousUser は Google のセッションが有効なときだけ
// googleSub のある行を返すので、それ以外（未ログイン）は 401 にする。
async function signedInUser() {
  const user = await getOrCreateAnonymousUser();
  if (!user.googleSub) throw new NoteValidationError(msg("Sign in to use custom instructions."), 401);
  return user;
}

export async function GET() {
  try {
    const user = await signedInUser();
    return NextResponse.json({ instructions: user.customInstructions }, NO_STORE);
  } catch (error) {
    return failure(error, msg("Could not load your custom instructions."));
  }
}

// 全体を置き換える。"" と null は指示なし。次に送るメッセージから反映される。
export async function PUT(request: Request) {
  try {
    // 指示は最大 4000 文字で、JSON のエスケープ分を見込んで既定より大きく許可する。
    const body = await readSmallJson(request, 16384);
    if (!("instructions" in body)) throw new NoteValidationError(msg("Nothing to update."));
    const instructions = validCustomInstructions(body.instructions);
    const user = await signedInUser();
    await prisma.anonymousUser.update({ where: { id: user.id }, data: { customInstructions: instructions } });
    return NextResponse.json({ instructions }, NO_STORE);
  } catch (error) {
    return failure(error, msg("Could not save your custom instructions. Please try again."));
  }
}
