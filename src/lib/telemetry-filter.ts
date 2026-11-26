// 計測ツールへ送らない画面：
// - /s/<token>（公開共有リンク。トークンを渡さない）
// - /note-embed（Android / iOS アプリの WebView。アプリには第三者の分析を入れないとプライバシーポリシーで約束している）
export const isEmbedPath = (pathname: string) => /(^|\/)note-embed\/?$/.test(pathname);

export function isUntrackedUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 絶対 URL でなければ、念のため /s/ を含むだけでも送らない。
    if (url.includes("/s/")) return true;
    pathname = url.split(/[?#]/)[0];
  }
  return pathname.startsWith("/s/") || isEmbedPath(pathname);
}
