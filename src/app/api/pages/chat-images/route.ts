import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { MAX_NOTE_FILE_BYTES, NOTE_IMAGE_EXTENSIONS, noteFileUrl, safeFileName, sniffImage } from "@/lib/note-file-keys";
import { prisma } from "@/lib/prisma";
import { readStoredImage } from "@/lib/storage";
import { scheduleStorageMaintenance, storeFile } from "@/lib/stored-files";

export const runtime = "nodejs";

// スライドに「チャットの画像」を置く。GET は自分のチャットにある画像（送った写真・AI が作った画像）を新しい順に、
// POST はその 1 枚をノートのファイル（note-files）へ写して URL を返す（スライドの保存で使用中になる）。
// 表示中の枝の発言（active）の添付だけ。画像はプレビュー用に /api/attachments/:id/image（持ち主を確かめる）で読む。
const LIST_LIMIT = 60;
// URL 全体の上限（parseNoteFileUrl の 600 文字）に収まるよう、長い（CJK などの）ファイル名を縮める。
const URL_BUDGET = 560;
// 文字は code point 単位で切る（絵文字などのサロゲートペアを分けると URL にできない）。
function fitName(path: string, name: string, extension: string) {
  // 切れた（対になっていない）サロゲートは捨てる。
  const whole = name.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  const dot = whole.lastIndexOf(".");
  const base = Array.from(dot > 0 ? whole.slice(0, dot) : whole);
  const suffix = dot > 0 ? whole.slice(dot) : "";
  for (let length = base.length; length > 0; length = length > 10 ? length - 10 : length - 1) {
    const candidate = base.slice(0, length).join("") + suffix;
    if (noteFileUrl(path, candidate).length <= URL_BUDGET) return candidate;
  }
  return `image.${extension}`;
}

export async function GET() {
  try {
    const user = await getOrCreateUser();
    const rows = await prisma.attachment.findMany({
      where: { imageStoragePath: { not: null }, size: { lte: MAX_NOTE_FILE_BYTES }, message: { active: true, session: { userId: user.id } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIST_LIMIT,
      select: { id: true, filename: true, createdAt: true, message: { select: { session: { select: { title: true } } } } },
    });
    return NextResponse.json({
      images: rows.map((row) => ({ id: row.id, filename: row.filename, sessionTitle: row.message.session.title, createdAt: row.createdAt.toISOString() })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { attachmentId?: unknown } | null;
    const id = typeof body?.attachmentId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.attachmentId) ? body.attachmentId : null;
    if (!id) return NextResponse.json({ error: msg("Image not found.") }, { status: 404 });
    const user = await getOrCreateUser();
    const attachment = await prisma.attachment.findFirst({
      where: { id, imageStoragePath: { not: null }, message: { active: true, session: { userId: user.id } } },
      select: { filename: true, size: true, imageStoragePath: true },
    });
    if (!attachment?.imageStoragePath) return NextResponse.json({ error: msg("Image not found.") }, { status: 404 });
    if (attachment.size > MAX_NOTE_FILE_BYTES) return NextResponse.json({ error: msg("Images must be 4 MB or smaller.") }, { status: 413 });
    let buffer: Buffer;
    try { buffer = await readStoredImage(attachment.imageStoragePath); }
    catch { return NextResponse.json({ error: msg("Image not found.") }, { status: 404 }); }
    if (buffer.byteLength > MAX_NOTE_FILE_BYTES) return NextResponse.json({ error: msg("Images must be 4 MB or smaller.") }, { status: 413 });
    const mime = sniffImage(buffer);
    if (!mime) return NextResponse.json({ error: msg("Choose a PNG, JPEG, WebP or GIF image.") }, { status: 400 });
    const extension = NOTE_IMAGE_EXTENSIONS[mime];
    const path = `note-files/${user.id}/${randomUUID()}.${extension}`;
    const name = fitName(path, safeFileName(attachment.filename) || `image.${extension}`, extension);
    // 写しも新しいファイルなので容量に数える。上限なら 413（code: "storage_limit"）。
    await storeFile(user, { path, kind: "NOTE_FILE", buffer, mimeType: mime });
    scheduleStorageMaintenance();
    return NextResponse.json({ url: noteFileUrl(path, name), name, size: buffer.byteLength }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
