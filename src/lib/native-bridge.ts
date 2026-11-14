import type { NotePage, NoteSaveStatus } from "@/types/notes";

// Android アプリ（mobile/android）の WebView にノートのエディターだけを載せる /note-embed と、アプリ側とのやり取り。
// 取り決めは docs/architecture/notes-flow.md の「Android アプリへの埋め込み」。ここを変えたらアプリ側も合わせる。

// web → アプリ。アプリは @JavascriptInterface の window.StudyMateNative.postMessage(JSON 文字列) で受け取る。
export type EmbedSaveState = "saved" | "saving" | "unsaved" | "error" | "conflict";
export type NativeMessage =
  | { type: "ready"; page: { id: string; title: string; icon: string | null } }
  | { type: "meta"; title: string; icon: string | null }
  | { type: "saveState"; state: EmbedSaveState }
  | { type: "missing" }
  | { type: "trashed" }
  // kept: 保存できなかったが、下書きはこの WebView の localStorage に残っていて後で送り直す（衝突ではない）。アプリはこのとき離れてよい。
  | { type: "flushed"; requestId: string; ok: boolean; kept?: boolean };

export type NativeHost = { postMessage: (json: string) => void };
// アプリ → web。アプリは evaluateJavascript で window.studymateEmbed.flush("<requestId>") などを呼ぶ。
// pageUpdated はアプリのチャットで編集案を適用したときに、サーバーが返した新しいページ（JSON 文字列かオブジェクト）を渡す。
export type EmbedApi = {
  flush: (requestId?: unknown) => Promise<boolean>;
  openHistory: () => void;
  pageUpdated: (page: unknown) => boolean;
};

type BridgeWindow = { StudyMateNative?: unknown; studymateEmbed?: EmbedApi };

function host(target: BridgeWindow | undefined): NativeHost | null {
  const candidate = target?.StudyMateNative as Partial<NativeHost> | undefined;
  // @JavascriptInterface のメソッドは typeof で "function" になる。
  return candidate && typeof candidate.postMessage === "function" ? (candidate as NativeHost) : null;
}

const browserWindow = () => (typeof window === "undefined" ? undefined : (window as unknown as BridgeWindow));

// アプリの外（普通のブラウザ）で開いたときは何も送らず false を返す。送れなくても画面は動き続ける。
export function postToNative(message: NativeMessage, target: BridgeWindow | undefined = browserWindow()): boolean {
  const native = host(target);
  if (!native) return false;
  try {
    native.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

// 保存キューの状態を、アプリへ渡す語に直す。pending（入力が止まるのを待っている）は unsaved。
// web の上部バーは pending と saving のどちらも「Saving…」と出す。
export function toEmbedSaveState(status: NoteSaveStatus): EmbedSaveState {
  return status === "pending" ? "unsaved" : status;
}

// 題名は保存時と同じく、空なら Untitled。
export function pageMeta(content: { title: string; icon: string | null }) {
  return { title: content.title.trim() || "Untitled", icon: content.icon ?? null };
}

// flush の requestId はアプリが付ける文字列。数値などで来ても文字列にそろえ、無ければ空文字で返す。
function requestIdOf(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

// アプリから渡されたページを確かめる。JSON 文字列でも受け、id・version・本文（blocks）がそろっていなければ捨てる。
export function parseUpdatedPage(value: unknown): NotePage | null {
  let page: unknown = value;
  if (typeof page === "string") {
    try { page = JSON.parse(page); } catch { return null; }
  }
  if (!page || typeof page !== "object") return null;
  const candidate = page as Partial<NotePage>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) return null;
  if (typeof candidate.title !== "string" || !Array.isArray(candidate.blocks)) return null;
  return candidate as NotePage;
}

// web の編集案カードと同じ studymate:page-updated を出す。useNotePages が受け取り、未保存の編集がなければ最新版に替え、
// あれば衝突として知らせる（docs/architecture/notes-flow.md）。
export function dispatchPageUpdated(page: NotePage) {
  window.dispatchEvent(new CustomEvent<NotePage>("studymate:page-updated", { detail: page }));
}

// window.studymateEmbed の中身。flush は保存し切れたか（未保存が残っていないか）を返し、同じ結果を flushed で知らせる。
// 保存できなかったときは、下書きが端末に残っていて後で送り直せるか（draftKept）も添える。
export function createEmbedApi({ flush, draftKept = () => false, openHistory, pageUpdated = dispatchPageUpdated, post }: {
  flush: () => Promise<boolean>;
  draftKept?: () => boolean;
  openHistory: () => void;
  pageUpdated?: (page: NotePage) => void;
  post: (message: NativeMessage) => void;
}): EmbedApi {
  return {
    async flush(requestId) {
      let ok = false;
      try { ok = (await flush()) === true; }
      catch { ok = false; }
      let kept = false;
      if (!ok) { try { kept = draftKept() === true; } catch { kept = false; } }
      post(ok ? { type: "flushed", requestId: requestIdOf(requestId), ok } : { type: "flushed", requestId: requestIdOf(requestId), ok, kept });
      return ok;
    },
    openHistory() { openHistory(); },
    pageUpdated(value) {
      const page = parseUpdatedPage(value);
      if (!page) return false;
      pageUpdated(page);
      return true;
    },
  };
}

// window.studymateEmbed を置く。戻り値で外す（別の API に置き換わっていたら触らない）。
export function installEmbedApi(api: EmbedApi, target: BridgeWindow | undefined = browserWindow()) {
  if (!target) return () => {};
  target.studymateEmbed = api;
  return () => { if (target.studymateEmbed === api) delete target.studymateEmbed; };
}
