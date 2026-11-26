// 計測ツールへ送らない画面：
// - /s/<token>（公開共有リンク。トークンを渡さない）
// - /note-embed（Android / iOS アプリの WebView。アプリには第三者の分析を入れないとプライバシーポリシーで約束している）
export function isUntrackedUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }
  return pathname.startsWith("/s/") || /(^|\/)note-embed\/?$/.test(pathname);
}
