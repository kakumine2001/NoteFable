import { NextResponse } from "next/server";
import { splitHosts } from "@/lib/hosts";

// 紹介サイトのホスト（notefable.com）に届いた /api/* の行き先（next.config.ts の rewrites）。API はワークスペースのホストだけで配る。
// 転送はしない（Webhook や App は転送を追わないので、登録先の間違いがすぐ分かるようにする）。
// 404 にもしない: 画面は 404 を「そのノートや会話が消えた」と読むので、古いホストを開いたままのタブで一覧から消えてしまう。
// 421（宛先のホストが違う）を返す。
function unavailable() {
  const hosts = splitHosts();
  return NextResponse.json(
    { error: hosts ? `This API is served from ${hosts.app}.` : "This API is not served from this host.", code: "wrong_host" },
    { status: 421, headers: { "Cache-Control": "no-store" } },
  );
}

export { unavailable as GET, unavailable as POST, unavailable as PUT, unavailable as PATCH, unavailable as DELETE, unavailable as HEAD, unavailable as OPTIONS };
