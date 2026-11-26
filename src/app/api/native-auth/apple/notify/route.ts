import { NextResponse } from "next/server";
import { syncAppleIdentityEvent } from "@/lib/native-apple-login";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { payload?: unknown } | null;
  if (typeof body?.payload !== "string" || !body.payload || body.payload.length > 24_000) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    return new NextResponse(null, { status: await syncAppleIdentityEvent(body.payload) ? 200 : 400 });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
