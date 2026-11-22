import type { Metadata } from "next";

// ワークスペースのホスト（本番では app.notefable.com）だけで PWA マニフェスト（share_target）を配る。
// 紹介サイト（notefable.com）からインストールされると Service Worker の無いホストへ共有 POST が届いてしまうため、ルートには置かない。
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
};

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
