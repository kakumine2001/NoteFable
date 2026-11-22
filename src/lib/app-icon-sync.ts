import { normalizeAppIcon, readAppIcon, saveAppIcon } from "@/lib/app-icon";
import { msg } from "@/lib/i18n/translate";

// 設定の「アイコン」をアカウントと同期する（ログイン中だけ。未ログインの端末は app-icon.ts のとおりこの端末だけ）。
// Android data/AppIconSync.kt、iOS Core/Support/AppIconSync.swift も同じ規則。
// - 読む（pullAppIconFromAccount）: 起動時と設定を開いたとき。サーバーに値があればそれを優先してこの端末に保存する。
//   サーバーにまだ値がなく（updatedAt が null）、この端末が既定以外を選んでいれば、それを一度だけ送る。
// - 書く（pushAppIconToAccount）: 設定で選んだとき。先にこの端末へ保存してから送る（通信できなくても端末の値は残る）。
// 送信は選んだ順に 1 件ずつ送り、古い返事が新しい選択を巻き戻さないようにする。読む途中で選び直したら、読んだ値は捨てる。
//
// 端末にはアイコンと一緒に次の 2 つを覚える（localStorage。タブ間で共有）:
// - 持ち主（OWNER_KEY）: 手元のアイコンがどのアカウントのものか（サーバーが返す不透明な鍵）。未ログインで選んだものは無し。
//   別のアカウントのものだったら、新しいアカウントへは送らずに既定へ戻す（前の人の画像を別のアカウントに入れない）。
// - 送信待ち（PENDING_KEY）: ログイン中に選んだのに、まだアカウントに届いていない。立っている間は、読んだときに
//   アカウントの古い値で上書きせず、手元の値を送り直す（オフラインで選んだものが次の読み込みで巻き戻らないように）。
// 明示的にログアウト・アカウント削除したときは、アカウントのアイコンを既定に戻す（forgetAccountAppIcon）。
const ENDPOINT = "/api/app-icon";
const OWNER_KEY = "notefable:app-icon-owner";
const PENDING_KEY = "notefable:app-icon-pending";

let signedIn = false;
// いまログインしているアカウントの鍵（このページでサーバーから受け取ったもの）。まだ分からなければ null。
let currentAccount: string | null = null;
// この端末で選んだ回数。読む途中に選び直されたかの判定と、最後の送信の結果だけを画面に返すのに使う。
let edits = 0;
// ログアウトで増やす。それより前に送った分の返事では、持ち主・送信待ちを書き換えない。
let generation = 0;
// 読んだ回数。読みが重なったとき、最後に始めた読みの結果だけを使う（先に始めた読みの遅い返事で新しい値を巻き戻さない）。
let pulls = 0;
let chain: Promise<unknown> = Promise.resolve();

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY) || null;
  } catch {
    return null;
  }
}

function readPending() {
  try {
    return window.localStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

// 持ち主と送信待ちを書く。書けない環境（プライベートブラウズなど）では覚えない（同期は今までどおり動く）。
function remember(owner: string | null, pending: boolean) {
  try {
    if (owner) window.localStorage.setItem(OWNER_KEY, owner);
    else window.localStorage.removeItem(OWNER_KEY);
    if (pending) window.localStorage.setItem(PENDING_KEY, "1");
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // 覚えられなくても、アイコンそのものは app-icon.ts が保存している。
  }
}

// ログインの状態を伝える（AccountAppIconSync）。
export function setAppIconAccount(value: boolean) {
  signedIn = value;
  if (!value) currentAccount = null;
}

function accountOf(data: unknown) {
  const account = data && typeof data === "object" ? (data as { account?: unknown }).account : undefined;
  return typeof account === "string" && account ? account : null;
}

// 1 件送る。届いたら持ち主をこのアカウントにして送信待ちを下ろす。
// markPending のとき（設定で選んだ値・送信待ちの送り直し）は、届かなければ送信待ちを立てたまま（次に読むときに送り直す）。
// 初めての同期で手元の値を送るとき（markPending なし）は、届かなくても印を付けない（次に読んだときに改めて判断する）。
async function send(icon: string | null, markPending: boolean): Promise<string> {
  const failed = msg("Could not save your icon. Please try again.");
  const mine = generation;
  // 先に立てておく（返事の前にタブを閉じても、次に読むときに送り直せる）。いま送る値はこのアカウントで選んだもの
  // なので、持ち主はいまのアカウント（鍵がまだ分からなければ無し。次に読んだときにこのアカウントへ送る）。
  if (markPending) remember(currentAccount, true);
  try {
    const response = await fetch(ENDPOINT, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icon }) });
    const data: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const account = accountOf(data);
      if (account) currentAccount = account;
      if (mine === generation) remember(account ?? currentAccount, false);
      return "";
    }
    // 401 は途中でログアウトした場合。この端末の値はもう保存済みなので何も言わない。
    if (response.status === 401) return "";
    const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
    return typeof error === "string" && error ? error : failed;
  } catch {
    return failed;
  }
}

function enqueue(icon: string | null, markPending: boolean) {
  const run = chain.then(() => send(icon, markPending));
  chain = run;
  return run;
}

// 設定で選んだ値をアカウントへ送る。失敗したときは理由の文（英語の原文）、成功・未ログイン・後に選び直したときは ""。
// 未ログインで選んだ値は誰のものでもない（持ち主なし、送信待ちなし）。
export function pushAppIconToAccount(icon: string | null): Promise<string> {
  if (!signedIn) {
    remember(null, false);
    return Promise.resolve("");
  }
  const mine = ++edits;
  return enqueue(icon, true).then((error) => (mine === edits ? error : ""));
}

// アカウントの値を読んでこの端末に反映する。読めないとき（通信できない・未ログイン）は端末の値のまま。
export async function pullAppIconFromAccount(): Promise<void> {
  if (!signedIn) return;
  const before = edits;
  const started = generation;
  const mine = ++pulls;
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
  if (!signedIn || edits !== before || generation !== started || mine !== pulls || !data || typeof data !== "object") return;
  const account = accountOf(data);
  if (account) currentAccount = account;
  const owner = readOwner();
  if (account && owner && owner !== account) {
    // 手元のアイコンは別のアカウントのもの: このアカウントへは送らず、既定に戻してから続ける。
    saveAppIcon(null);
    remember(null, false);
  }
  if (readPending()) {
    // まだ届いていない選択がある: アカウントの古い値で上書きせず、手元の値を送り直す（届かなければ送信待ちのまま）。
    await enqueue(readAppIcon(), true);
    return;
  }
  if (typeof data.updatedAt === "string" && data.updatedAt) {
    const icon = normalizeAppIcon(data.icon);
    if (icon !== readAppIcon()) saveAppIcon(icon);
    remember(account, false);
    return;
  }
  // まだどの端末からも保存していない: この端末の選択（未ログインで選んだものか、このアカウントのもの）を最初の値にする。
  const local = readAppIcon();
  if (local !== null) await enqueue(local, false);
}

// 明示的にログアウト・アカウントを削除したとき。手元のアイコンがアカウントのもの（持ち主あり、または送信待ち）なら既定に戻す
// （次にこの端末を使う人に、前のアカウントの画像を残さない）。未ログインで選んだものはそのまま。
export function forgetAccountAppIcon() {
  generation += 1;
  signedIn = false;
  currentAccount = null;
  if (readOwner() !== null || readPending()) saveAppIcon(null);
  remember(null, false);
}
