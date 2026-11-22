import { normalizeAppIcon, readAppIcon, saveAppIcon } from "@/lib/app-icon";
import { msg } from "@/lib/i18n/translate";

// 設定の「アイコン」をアカウントと同期する（ログイン中だけ。未ログインの端末は app-icon.ts のとおりこの端末だけ）。
// - 読む（pullAppIconFromAccount）: 起動時と設定を開いたとき。サーバーに値があればそれを優先してこの端末に保存する。
//   サーバーにまだ値がなく（updatedAt が null）、この端末が既定以外を選んでいれば、それを一度だけ送る。
// - 書く（pushAppIconToAccount）: 設定で選んだとき。先にこの端末へ保存してから送る（通信できなくても端末の値は残る）。
// 送信は選んだ順に 1 件ずつ送り、古い返事が新しい選択を巻き戻さないようにする。読む途中で選び直したら、読んだ値は捨てる。
const ENDPOINT = "/api/app-icon";

let signedIn = false;
// この端末で選んだ回数。読む途中に選び直されたかの判定と、最後の送信の結果だけを画面に返すのに使う。
let edits = 0;
let chain: Promise<unknown> = Promise.resolve();

// ログインの状態を伝える（AccountAppIconSync）。
export function setAppIconAccount(value: boolean) {
  signedIn = value;
}

async function send(icon: string | null): Promise<string> {
  const failed = msg("Could not save your icon. Please try again.");
  try {
    const response = await fetch(ENDPOINT, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icon }) });
    // 401 は途中でログアウトした場合。この端末の値はもう保存済みなので何も言わない。
    if (response.ok || response.status === 401) return "";
    const data: unknown = await response.json().catch(() => null);
    const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
    return typeof error === "string" && error ? error : failed;
  } catch {
    return failed;
  }
}

function enqueue(icon: string | null) {
  const run = chain.then(() => send(icon));
  chain = run;
  return run;
}

// 設定で選んだ値をアカウントへ送る。失敗したときは理由の文（英語の原文）、成功・未ログイン・後に選び直したときは ""。
export function pushAppIconToAccount(icon: string | null): Promise<string> {
  if (!signedIn) return Promise.resolve("");
  const mine = ++edits;
  return enqueue(icon).then((error) => (mine === edits ? error : ""));
}

// アカウントの値を読んでこの端末に反映する。読めないとき（通信できない・未ログイン）は端末の値のまま。
export async function pullAppIconFromAccount(): Promise<void> {
  if (!signedIn) return;
  const before = edits;
  // 送信待ちの選択があれば、それが届いてから読む。
  await chain;
  let data: { icon?: unknown; updatedAt?: unknown };
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store" });
    if (!response.ok) return;
    data = await response.json();
  } catch {
    return;
  }
  if (!signedIn || edits !== before || !data || typeof data !== "object") return;
  if (typeof data.updatedAt === "string" && data.updatedAt) {
    const icon = normalizeAppIcon(data.icon);
    if (icon !== readAppIcon()) saveAppIcon(icon);
    return;
  }
  // まだどの端末からも保存していない: この端末の選択を、このアカウントの最初の値にする。
  const local = readAppIcon();
  if (local !== null) await enqueue(local);
}
