import { NextResponse } from "next/server";
import { readCanvasDataForShare } from "@/lib/canvas-store";
import { isLocale, LOCALE_COOKIE, parsePreference, resolveLocale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { resolvePublicShare, resolvePublicShareCards } from "@/lib/note-share-server";
import { whiteboardPageCardIds } from "@/lib/whiteboard/links";
import { publicWhiteboardScene } from "@/lib/whiteboard/public";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function sceneLocale(request: Request) {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  if (isLocale(lang)) return lang;
  return resolveLocale({
    preference: parsePreference(cookieValue(request.headers.get("cookie"), LOCALE_COOKIE)),
    acceptLanguage: request.headers.get("accept-language"),
    country: request.headers.get("x-vercel-ip-country"),
  });
}

// 公開ページのホワイトボードの本体（読み取り専用のビューが読む）。公開されていない・ホワイトボードでないページは 404。
// 画像の URL は /s/:token/file に置き換える（そのホワイトボードが参照している画像だけが読める）。
// ページカードは同じ公開ツリー内のページだけ最新の題名・要約を返し、ツリー外のカードは題名と参照先を伏せる。
export async function GET(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const pageId = new URL(request.url).searchParams.get("page");
    const resolved = await resolvePublicShare(token, pageId, undefined, { includeEmbeddedWhiteboards: false });
    if (!resolved || resolved.page.kind !== "whiteboard") return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    // ゴミ箱に入ったページの本体は出さない（readCanvasDataForShare は deletedAt: null で読む。読めなければ空の白板）。
    const data = await readCanvasDataForShare(resolved.page.id) ?? { elements: [] };
    const cardIds = whiteboardPageCardIds(data);
    const cards = cardIds.length ? await resolvePublicShareCards(token, resolved.root, cardIds) : {};
    const t = createTranslator(messagesFor(sceneLocale(request)));
    const scene = publicWhiteboardScene(data, token, resolved.page.id, {
      cards,
      untitled: t("Untitled"),
      unavailableLabel: t("This page is not available"),
    });
    return NextResponse.json({ scene, cards }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch {
    return NextResponse.json({ error: "Request failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
