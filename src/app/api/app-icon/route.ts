import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { APP_ICON_IMAGE, APP_ICON_ROOT, MAX_APP_ICON_BYTES, appIconAccountKey, appIconDataUrl, appIconMimeType, parseAppIconInput } from "@/lib/account-app-icon";
import { getOrCreateUser, isAccountUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";
import { StoredImageNotFoundError, deleteStoredImage, getImageExtension, readStoredImage, writeStoredImageAt } from "@/lib/storage";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
// 64 KB の画像の base64（約 88 KB）と JSON の余白。
const MAX_BODY_CHARS = 96 * 1024;

function failure(error: unknown, fallback: string) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("App icon request failed", error);
  return NextResponse.json({ error: fallback }, { status: 503 });
}

// 設定の「アイコン」の同期はログインした利用者だけ（未ログインの端末は、その端末にだけ保存する）。
async function signedInUser() {
  const user = await getOrCreateUser();
  if (!isAccountUser(user)) throw new NoteValidationError(msg("Sign in to sync your icon."), 401);
  return user;
}

// 保存した画像を data URL にする。画像が保存先に無い（消えた）・形式が分からないときは null（既定のキャラクター）にして記録する
// （503 を返し続けると、どの端末もずっと同期できない）。一時的な読み取りの失敗は例外のまま（503、端末は手元の値を使い続ける）。
async function storedImageIcon(storagePath: string) {
  const mimeType = appIconMimeType(storagePath);
  if (!mimeType) {
    console.error("App icon has an unknown image type; answering the default icon", storagePath);
    return null;
  }
  try {
    // 小さい画像なので、別の URL にせずこの返事に入れる（端末はこのまま保存して表示する）。
    return appIconDataUrl(await readStoredImage(storagePath, MAX_APP_ICON_BYTES), mimeType);
  } catch (error) {
    if (!(error instanceof StoredImageNotFoundError)) throw error;
    console.error("App icon image is missing from storage; answering the default icon", storagePath);
    return null;
  }
}

// アカウントのアイコン。icon は端末と同じ形（null / "character:<id>" / 画像の data URL）。
// updatedAt が null なら、まだどの端末からも保存していない（端末側が自分の設定を一度だけ送る目印）。
// account はこのアカウントの不透明な鍵。端末は手元のアイコンがどのアカウントのものかを覚えるのに使う。
export async function GET() {
  try {
    const user = await signedInUser();
    let icon = user.appIcon === APP_ICON_IMAGE ? null : user.appIcon;
    if (user.appIcon === APP_ICON_IMAGE && user.appIconImage) icon = await storedImageIcon(user.appIconImage);
    return NextResponse.json({ icon, updatedAt: user.appIconUpdatedAt?.toISOString() ?? null, account: appIconAccountKey(user.id) }, NO_STORE);
  } catch (error) {
    return failure(error, msg("Could not load your icon."));
  }
}

// 全体を置き換える。null と "" は既定のキャラクター（Quill）。
export async function PUT(request: Request) {
  try {
    // 先にログインを確かめる（未ログインには、本文の内容に関わらず 401 を返す）。
    const user = await signedInUser();
    const body = await readSmallJson(request, MAX_BODY_CHARS);
    if (!("icon" in body)) throw new NoteValidationError(msg("Nothing to update."));
    const input = parseAppIconInput(body.icon);

    const storagePath = input.kind === "image" ? `${APP_ICON_ROOT}/${user.id}/${randomUUID()}${getImageExtension(input.mimeType)}` : null;
    if (input.kind === "image") await writeStoredImageAt(storagePath!, input.bytes, input.mimeType);
    const updatedAt = new Date();
    try {
      // 読んだときの画像のままの場合だけ置き換える（同時に別の端末が置き換えていたら、そちらの画像を消さないように、こちらを取り消す）。
      const result = await prisma.user.updateMany({
        where: { id: user.id, appIconImage: user.appIconImage },
        data: { appIcon: input.kind === "image" ? APP_ICON_IMAGE : input.value, appIconImage: storagePath, appIconUpdatedAt: updatedAt },
      });
      if (!result.count) throw new NoteValidationError(msg("Your icon changed somewhere else. Try again."), 409);
    } catch (error) {
      // 行を更新できなかったら、書いたばかりの画像は誰からも参照されないので消す。
      if (storagePath) await deleteStoredImage(storagePath).catch(() => {});
      throw error;
    }
    // 置き換える前の画像を消す（消せなくても保存は成功のまま。残っても本人のフォルダにあり、アカウント削除で消える）。
    if (user.appIconImage) await deleteStoredImage(user.appIconImage).catch(() => {});

    const icon = input.kind === "image" ? appIconDataUrl(input.bytes, input.mimeType) : input.value;
    return NextResponse.json({ icon, updatedAt: updatedAt.toISOString(), account: appIconAccountKey(user.id) }, NO_STORE);
  } catch (error) {
    return failure(error, msg("Could not save your icon. Please try again."));
  }
}
