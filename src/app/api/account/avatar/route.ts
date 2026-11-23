import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { currentAccountProfile, getOrCreateUser, isAccountUser } from "@/lib/auth";
import { sniffImage } from "@/lib/note-file-keys";
import { readLimitedBody } from "@/lib/note-upload";
import { prisma } from "@/lib/prisma";
import { getImageExtension, readStoredImage } from "@/lib/storage";
import { discardStoredFiles, storeFile } from "@/lib/stored-files";
import { AVATAR_ROOT, avatarVersion, toAccountUser } from "@/lib/user-profile";
import { msg } from "@/lib/i18n/translate";

export const runtime = "nodejs";

// ブラウザが 512px に切り抜いてから送るので、写真は通常 数十 KB（WebP）。Safari で PNG になっても数百 KB。
// 上限は主流のサービスに合わせて 2 MB（X と同じ）。multipart の余白込みで受け取る。
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

async function currentProfile() {
  // Google でもメールでも、ログインしている本人のプロフィール。
  return currentAccountProfile().catch(() => null);
}

// 写真を差し替える。Google にログインしている本人だけ。古い写真は消し、絵文字アイコンは外す（写真かアイコンのどちらか一方）。
export async function POST(request: Request) {
  const google = await currentProfile();
  if (!google) return NextResponse.json({ error: msg("Sign in to change your photo.") }, { status: 401 });

  const tooLarge = () => NextResponse.json({ error: msg("That photo is too large.") }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  // Content-Length がない送信でも、実際に受け取ったバイト数で上限を守ってから解析する。
  const body = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!body) return tooLarge();

  let entries: [string, FormDataEntryValue][];
  try {
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    entries = [...form.entries()];
  } catch {
    return NextResponse.json({ error: msg("Invalid upload.") }, { status: 400 });
  }
  const file = entries.length === 1 && entries[0][0] === "file" ? entries[0][1] : null;
  if (!(file instanceof File)) return NextResponse.json({ error: msg("Choose one photo to upload.") }, { status: 400 });
  if (file.size > MAX_AVATAR_BYTES) return tooLarge();

  const buffer = Buffer.from(await file.arrayBuffer());
  // 申告された種類ではなく、中身の先頭バイトで画像かどうかを判断する。
  const mimeType = sniffImage(buffer);
  if (!mimeType) return NextResponse.json({ error: msg("Upload a JPEG, PNG, WebP or GIF photo.") }, { status: 400 });

  const row = await getOrCreateUser();
  if (!isAccountUser(row)) return NextResponse.json({ error: msg("Sign in to change your photo.") }, { status: 401 });

  const storagePath = `${AVATAR_ROOT}/${row.id}/${randomUUID()}${getImageExtension(mimeType)}`;
  // 容量に数えるが、上限では断らない（1 枚を置き換えるだけで、古い写真はすぐ消す）。
  await storeFile(row, { path: storagePath, kind: "AVATAR", buffer, mimeType }, { enforce: false, held: true });

  // 読んだときの写真のままの場合だけ差し替える（同時に別のタブが差し替えていたら、そちらを消さず、こちらを取り消す）。
  try {
    const result = await prisma.user.updateMany({
      where: { id: row.id, avatarImage: row.avatarImage },
      data: { avatarImage: storagePath, avatarIcon: null },
    });
    if (!result.count) {
      await discardStoredFiles([storagePath]);
      return NextResponse.json({ error: msg("Your photo changed somewhere else. Try again.") }, { status: 409 });
    }
  } catch (error) {
    // 行を更新できなかったら、書いたばかりの写真は誰からも参照されないので消す。
    await discardStoredFiles([storagePath]);
    throw error;
  }
  // 差し替え前の写真を消す（消せなくても保存は成功のまま。残っても本人だけが読める場所にある）。
  if (row.avatarImage && row.avatarImage !== storagePath) await discardStoredFiles([row.avatarImage]);
  // 更新が確定した後の読取失敗では、現在参照されている新しい写真を消さない。
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: row.id } });

  return NextResponse.json({ user: toAccountUser(updated, google) }, { status: 201 });
}

// 自分の写真だけを返す。URL の v はアップロードごとに変わる版で、現在の版のときだけ長くキャッシュさせる。
export async function GET(request: Request) {
  const google = await currentProfile();
  if (!google) return NextResponse.json({ error: msg("Not found.") }, { status: 404 });

  const row = await getOrCreateUser();
  if (!isAccountUser(row) || !row.avatarImage) return NextResponse.json({ error: msg("Not found.") }, { status: 404 });

  let image: Buffer;
  try {
    image = await readStoredImage(row.avatarImage);
  } catch {
    return NextResponse.json({ error: msg("Not found.") }, { status: 404 });
  }

  const requested = new URL(request.url).searchParams.get("v");
  const current = requested !== null && requested === avatarVersion(row.avatarImage);
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": CONTENT_TYPES[row.avatarImage.split(".").pop() ?? ""] ?? "application/octet-stream",
      // 版が合っているときは内容が変わらないので長く、そうでなければ毎回確かめさせる。端末ごとの画像なので共有キャッシュには載せない。
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
