import { NextResponse } from "next/server";
import { splitHosts } from "@/lib/hosts";

// 紹介サイトのホスト（notefable.com）に届いた /api/* の行き先（next.config.ts の rewrites）。API はワークスペースのホストだけで配る。
// 転送はしない（Webhook や App は転送を追わないので、登録先の間違いが 404 ですぐ分かるようにする）。
function unavailable() {
  const hosts = splitHosts();
  return NextResponse.json(
    { error: hosts ? `This API is served from ${hosts.app}.` : "Not found." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export { unavailable as GET, unavailable as POST, unavailable as PUT, unavailable as PATCH, unavailable as DELETE, unavailable as HEAD, unavailable as OPTIONS };
