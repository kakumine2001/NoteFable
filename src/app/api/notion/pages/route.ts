import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import {
  createNotionPage,
  NotionConfigurationError,
  NotionWriteError,
} from "@/lib/notion";
import { prisma } from "@/lib/prisma";

type NotionPageRequest = {
  title?: unknown;
  content?: unknown;
  sessionId?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as NotionPageRequest;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!title || !content) {
    return NextResponse.json({ error: "Title and content are required." }, { status: 400 });
  }

  if (sessionId) {
    // sessionId がある時だけ所有者確認する。手動メモはセッションなしでも保存できる。
    const user = await getOrCreateAnonymousUser();
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
      select: { id: true },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
  }

  try {
    const result = await createNotionPage({ title, content });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotionConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof NotionWriteError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({ error: "Failed to save to Notion." }, { status: 502 });
  }
}
