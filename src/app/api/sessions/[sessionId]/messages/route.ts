import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function toPublicAttachment<T extends { imageStoragePath?: string | null; id: string }>(
  attachment: T,
) {
  const { imageStoragePath: _imageStoragePath, ...rest } = attachment;

  return {
    ...rest,
    dataUrl: _imageStoragePath ? `/api/attachments/${attachment.id}/image` : undefined,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getOrCreateAnonymousUser();
  const { sessionId } = await context.params;

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

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      reasoningEffort: true,
      createdAt: true,
      attachments: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          imageStoragePath: true,
        },
      },
    },
  });

  return NextResponse.json({
    messages: messages.map((message) => {
      const generatedImages =
        message.role === "ASSISTANT"
          ? message.attachments
              .filter((attachment) => attachment.imageStoragePath)
              .map((attachment) => ({
                id: attachment.id,
                dataUrl: `/api/attachments/${attachment.id}/image`,
                mimeType: attachment.mimeType,
              }))
          : [];

      return {
        ...message,
        generatedImages,
        attachments: message.attachments
          .filter(
            (attachment) =>
              message.role !== "ASSISTANT" ||
              !attachment.imageStoragePath,
          )
          .map(toPublicAttachment),
      };
    }),
  });
}
