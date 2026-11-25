import { NextResponse } from "next/server";
import { appleStoreProduct, isInvalidAppleSignature, syncAppleNotification } from "@/lib/apple-app-store";

export async function POST(request: Request) {
  if (!appleStoreProduct()) return new NextResponse(null, { status: 503 });
  const body = await request.json().catch(() => null) as { signedPayload?: unknown } | null;
  if (typeof body?.signedPayload !== "string" || !body.signedPayload || body.signedPayload.length > 64_000) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    await syncAppleNotification(body.signedPayload);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return new NextResponse(null, { status: isInvalidAppleSignature(error) ? 400 : 502 });
  }
}
