import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getOrCreateAnonymousUser();
  const { sessionId } = await context.params;

  const deleted = await prisma.session.deleteMany({
    where: {
      id: sessionId,
      userId: user.id,
    },
  });

  if (!deleted.count) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
