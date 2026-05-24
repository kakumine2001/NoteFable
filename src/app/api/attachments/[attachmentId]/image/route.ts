import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getOrCreateAnonymousUser();
  const { attachmentId } = await context.params;

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        session: {
          userId: user.id,
        },
      },
      imageStoragePath: { not: null },
    },
    select: {
      mimeType: true,
      imageStoragePath: true,
    },
  });

  if (!attachment?.imageStoragePath) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  try {
    const image = await readStoredImage(attachment.imageStoragePath);

    return new Response(image, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Attachment file not found." }, { status: 404 });
  }
}
