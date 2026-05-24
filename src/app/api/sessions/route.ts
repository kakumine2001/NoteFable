import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getOrCreateAnonymousUser();
  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ sessions });
}

export async function POST() {
  const user = await getOrCreateAnonymousUser();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      title: "New chat",
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ session }, { status: 201 });
}
