import { isLocale, type Locale } from "@/lib/i18n/locale";
import { isImageIcon, parseCharacterIcon, saveAppIcon, toCharacterIcon } from "@/lib/app-icon";
import { parseThemePreference, saveThemePreference, type ThemePreference } from "@/lib/theme";
import { pageSettingsOf, type NotePage, type NotePageSummary, type NoteSaveStatus, type PageKind } from "@/types/notes";
import { PAGES_TRASHED_EVENT } from "@/lib/proposal-sync";
import type { UsageTier } from "@/lib/usage-plans";

// Android アプリ（mobile/android）の WebView にノートのエディターだけを載せる /note-embed と、アプリ側とのやり取り。
// 取り決めは docs/architecture/notes-flow.md の「Android アプリへの埋め込み」。ここを変えたらアプリ側も合わせる。

// web → アプリ。アプリは @JavascriptInterface の window.NoteFableNative.postMessage(JSON 文字列) で受け取る。
export type EmbedSaveState = "saved" | "saving" | "unsaved" | "error" | "conflict";
export type NativeMessage =
  // kind はページの種類（note / whiteboard / slides）。古いアプリは読まない（知らない項目は無視する）。
  | { type: "ready"; page: { id: string; title: string; icon: string | null; kind?: PageKind } }
  | { type: "meta"; title: string; icon: string | null }
  | { type: "saveState"; state: EmbedSaveState }
  | { type: "missing"; id?: string }
  | { type: "trashed" }
  // ノートの中のページのメンションを押した。アプリはそのページを開く（自分のページか、無いかはアプリ側で確かめる）。
  | { type: "openPage"; id: string }
  // kept: 保存できなかったが、下書きはこの WebView の localStorage に残っていて後で送り直す（衝突ではない）。アプリはこのとき離れてよい。
  | { type: "flushed"; requestId: string; ok: boolean; kept?: boolean }
  // ファイル置き場の容量が足りず、画像・ファイル・カバーのアップロードが断られた（used / limit はバイト）。
  // アプリは自分の画面で理由と、ログイン・アップグレードの案内を出す。canShowStorageLimit を持つアプリにだけ送る。
  | { type: "storageLimit"; tier: UsageTier; used: number; limit: number }
  // スライドの放映。start / end で、アプリは横向き・全画面・画面の常時点灯にする（戻す）。slide は見せている枚が替わった（index は 0 から、count は全体の枚数）。
  // canPresent を持つアプリにだけ送る。
  | { type: "presentation"; state: "start" | "slide" | "end"; index: number; count: number }
  // 書き出したファイル（ホワイトボードの PNG・SVG・PDF、スライドの PDF・PNG・PPTX など）を、アプリに保存してもらう。canSaveFile を持つアプリにだけ送る。
  // 大きいファイルを 1 つの文字列にしないよう分けて送る：fileStart → fileChunk（中身の base64、元のバイトで 512 KiB まで、index は 0 から）×n → fileEnd。
  // fileEnd でアプリが保存先を選ばせる。途中でやめたら fileAbort（src/lib/export-file.ts）。
  | { type: "fileStart"; id: string; name: string; mime: string; size: number }
  | { type: "fileChunk"; id: string; index: number; data: string }
  | { type: "fileEnd"; id: string }
  | { type: "fileAbort"; id: string }
  // ホワイトボードで描く道具（ペン・図形など）を使っているか。アプリはこの間、端の戻るジェスチャーを避ける（Android は端ごとに 200dp まで）。
  // 古いアプリは知らない種類として無視する。
  | { type: "drawing"; active: boolean };

// appIcon はアプリの設定で選んだアイコン（絵文字 1 つか画像の data URL、既定のロゴは空文字）を返す。古いアプリにはない。
// canOpenPage は openPage を処理できるアプリだけが持つ（古いアプリは持たない。そのときは送らずに元のリンクの動きにする）。
// canShowStorageLimit は storageLimit を処理できるアプリだけが持つ（古いアプリには送らず、WebView の中に理由だけを出す）。
// canPresent は放映（presentation）を、canSaveFile はファイルの保存（fileStart…fileEnd）を受け持てるアプリだけが持つ。
export type NativeHost = {
  postMessage: (json: string) => void; appIcon?: () => string; language?: () => string; theme?: () => string; canOpenPage?: () => boolean; canShowStorageLimit?: () => boolean;
  canPresent?: () => boolean; canSaveFile?: () => boolean;
};
// アプリ → web。アプリは evaluateJavascript で window.notefableEmbed.flush("<requestId>") などを呼ぶ。
// pageUpdated はアプリのチャットで編集案を適用したときに、サーバーが返した新しいページ（JSON 文字列かオブジェクト）を渡す。
export type EmbedApi = {
  language: (locale: unknown) => Promise<boolean>;
  theme: (value: unknown) => boolean;
  flush: (requestId?: unknown) => Promise<boolean>;
  openHistory: () => void;
  pageUpdated: (page: unknown) => boolean;
  // アプリの「…」メニューで表示設定・ロック・お気に入りを変えたとき、PUT が返した一覧の 1 件（JSON 文字列かオブジェクト）を渡す。
  pageSettings: (page: unknown) => boolean;
  // アプリの設定でアイコンを替えたとき、その値（絵文字 1 つか画像の data URL。null か空文字は既定のロゴ）を渡す。
  appIcon: (icon: unknown) => boolean;
  // 開いているページの中で、検索で一致したブロック（ノート）・要素（ホワイトボード）まで動かす（URL の reveal と同じ）。
  // 開き直さずに済むよう、すでに開いているページの検索結果を選んだときにアプリが呼ぶ。ID の形でなければ false。
  reveal: (target: unknown) => boolean;
  // スライドの操作（アプリの「…」メニュー・戻るボタン）：{ action: "present" | "end" | "next" | "previous" | "goto" | "export", index?, format? }（JSON 文字列でもよい）。
  slides: (command: unknown) => boolean;
  // 常駐再利用している /note-embed WebView 内で、ページ全体を再読み込みせずに別ページへ切り替える。
  openPage: (request: unknown) => boolean;
  // 一覧・チャットへ戻るときに現在のエディター DOM を閉じてメモリを解放し、WebView とキャッシュだけ残す。
  close: () => boolean;
  // アプリ側でゴミ箱へ移したページ（およびサブページ）の ID を知らせ、常駐 WebView 内のキャッシュを消す（未保存の下書きは復元時のため残す）。
  pageTrashed: (ids: unknown) => boolean;
};

type BridgeWindow = { NoteFableNative?: unknown; notefableEmbed?: EmbedApi };

function host(target: BridgeWindow | undefined): NativeHost | null {
  const candidate = target?.NoteFableNative as Partial<NativeHost> | undefined;
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

// アプリから渡されたアイコン設定を確かめる。null・空文字・Quill は既定キャラクター（null）、
// 他のプリセットは "character:<id>"、画像の data URL はそのまま、それ以外（旧絵文字や壊れた値）は undefined。
export function parseAppIcon(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (isImageIcon(value)) return value;
  const characterId = parseCharacterIcon(value);
  return characterId ? toCharacterIcon(characterId) : undefined;
}

// アプリの設定で選んだアイコンを読む。アプリの外や、アイコンを渡さない古いアプリでは undefined（WebView に覚えている値を変えない）。
// 読めない値は既定のロゴ（null）にする。
export function readNativeAppIcon(target: BridgeWindow | undefined = browserWindow()): string | null | undefined {
  const native = host(target);
  if (!native || typeof native.appIcon !== "function") return undefined;
  try {
    return parseAppIcon(native.appIcon()) ?? null;
  } catch {
    return undefined;
  }
}

// Read the native effective language after mounting; it can change while the
// initial HTML is loading. Never accept an untranslated or invalid locale.
// アプリがノートの中のページへのリンク（openPage）を開けるか。古いアプリや普通のブラウザでは false。
export function nativeCanOpenPage(target: BridgeWindow | undefined = browserWindow()): boolean {
  const native = host(target);
  if (!native || typeof native.canOpenPage !== "function") return false;
  try { return native.canOpenPage() === true; } catch { return false; }
}

// アプリが容量の上限の案内（storageLimit）を自分の画面で出せるか。古いアプリや普通のブラウザでは false。
export function nativeCanShowStorageLimit(target: BridgeWindow | undefined = browserWindow()): boolean {
  const native = host(target);
  if (!native || typeof native.canShowStorageLimit !== "function") return false;
  try { return native.canShowStorageLimit() === true; } catch { return false; }
}

// アプリが放映（横向き・全画面・常時点灯）を受け持てるか。古いアプリや普通のブラウザでは false（そのときは WebView の中だけで放映する）。
export function nativeCanPresent(target: BridgeWindow | undefined = browserWindow()): boolean {
  const native = host(target);
  if (!native || typeof native.canPresent !== "function") return false;
  try { return native.canPresent() === true; } catch { return false; }
}

// アプリの中（WebView）で開いているか。
export function inNativeApp(target: BridgeWindow | undefined = browserWindow()): boolean {
  return host(target) !== null;
}

// アプリがファイルの保存（fileStart … fileEnd）を処理できるか。古いアプリや普通のブラウザでは false。
export function nativeCanSaveFile(target: BridgeWindow | undefined = browserWindow()): boolean {
  const native = host(target);
  if (!native || typeof native.canSaveFile !== "function") return false;
  try { return native.canSaveFile() === true; } catch { return false; }
}

export type SlidesCommand = { action: "present" | "end" | "next" | "previous" | "goto" | "export"; index?: number; format?: "pdf" | "pdf-notes" | "png" | "pptx" };
const SLIDES_ACTIONS = ["present", "end", "next", "previous", "goto", "export"];
const EXPORT_FORMATS = ["pdf", "pdf-notes", "png", "pptx"];

// アプリから渡されたスライドの操作を確かめる。知らない操作・形式は捨てる。
export function parseSlidesCommand(value: unknown): SlidesCommand | null {
  let command: unknown = value;
  if (typeof command === "string") {
    try { command = JSON.parse(command); } catch { command = { action: command }; }
  }
  if (!command || typeof command !== "object") return null;
  const candidate = command as { action?: unknown; index?: unknown; format?: unknown };
  if (typeof candidate.action !== "string" || !SLIDES_ACTIONS.includes(candidate.action)) return null;
  const result: SlidesCommand = { action: candidate.action as SlidesCommand["action"] };
  if (typeof candidate.index === "number" && Number.isSafeInteger(candidate.index) && candidate.index >= 0) result.index = candidate.index;
  if (candidate.action === "goto" && result.index === undefined) return null;
  if (candidate.action === "export") {
    if (typeof candidate.format !== "string" || !EXPORT_FORMATS.includes(candidate.format)) return null;
    result.format = candidate.format as SlidesCommand["format"];
  }
  return result;
}

export function readNativeLanguage(target: BridgeWindow | undefined = browserWindow()): Locale | null {
  try {
    const value = host(target)?.language?.();
    return isLocale(value) ? value : null;
  } catch { return null; }
}

// Read the native effective theme ("light" / "dark" / "system") after mounting.
export function readNativeTheme(target: BridgeWindow | undefined = browserWindow()): ThemePreference | null {
  try {
    const value = host(target)?.theme?.();
    return parseThemePreference(value) ?? null;
  } catch { return null; }
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

// アプリから渡された一覧の 1 件（表示設定・お気に入り）を確かめる。id がなければ捨て、設定は不明な値を既定値にそろえる。
export type PageMetaUpdate = Pick<NotePageSummary, "id" | "favoritedAt" | "fullWidth" | "smallText" | "font" | "locked">;
export function parsePageSettings(value: unknown): PageMetaUpdate | null {
  let page: unknown = value;
  if (typeof page === "string") {
    try { page = JSON.parse(page); } catch { return null; }
  }
  if (!page || typeof page !== "object") return null;
  const candidate = page as Partial<NotePageSummary>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  const favoritedAt = typeof candidate.favoritedAt === "string" ? candidate.favoritedAt : null;
  return { id: candidate.id, favoritedAt, ...pageSettingsOf(candidate) };
}

// useNotePages が受け取り、一覧のその 1 件の表示設定・お気に入りを置き換える（/note-embed では開いているページに効く）。
export function dispatchPageMeta(page: PageMetaUpdate) {
  window.dispatchEvent(new CustomEvent<PageMetaUpdate>("notefable:page-meta", { detail: page }));
}

// web の編集案カードと同じ notefable:page-updated を出す。useNotePages が受け取り、未保存の編集がなければ最新版に替え、
// あれば衝突として知らせる（docs/architecture/notes-flow.md）。
export function dispatchPageUpdated(page: NotePage) {
  window.dispatchEvent(new CustomEvent<NotePage>("notefable:page-updated", { detail: page }));
}

// window.notefableEmbed の中身。flush は保存し切れたか（未保存が残っていないか）を返し、同じ結果を flushed で知らせる。
// 保存できなかったときは、下書きが端末に残っていて後で送り直せるか（draftKept）も添える。
// 検索の一致先（ブロック・要素の ID）の形。
export const REVEAL_TARGET = /^[A-Za-z0-9_-]{1,120}$/;

// スライドのエディターへ操作を渡す（エディターは notefable:slides-command を聞いている。src/lib/slides/ai-context.ts）。
export function dispatchSlidesCommand(command: SlidesCommand) {
  window.dispatchEvent(new CustomEvent<SlidesCommand>("notefable:slides-command", { detail: command }));
}

export type OpenPageRequest = {
  id: string;
  reveal: string | null;
  model: string | null;
  reasoning: string | null;
};

// 常駐 WebView のページ切り替え依頼を確かめる。ID 文字列か JSON（{ id, reveal?, model?, reasoning? }）を受け付ける。
export function parseOpenPageRequest(value: unknown): OpenPageRequest | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try { raw = JSON.parse(trimmed); } catch { return null; }
    } else {
      raw = { id: trimmed };
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { id?: unknown; reveal?: unknown; model?: unknown; reasoning?: unknown };
  if (typeof candidate.id !== "string" || !REVEAL_TARGET.test(candidate.id)) return null;
  const reveal = typeof candidate.reveal === "string" && REVEAL_TARGET.test(candidate.reveal) ? candidate.reveal : null;
  const model = typeof candidate.model === "string" && candidate.model.trim() ? candidate.model.trim() : null;
  const reasoning = typeof candidate.reasoning === "string" && candidate.reasoning.trim() ? candidate.reasoning.trim() : null;
  return { id: candidate.id, reveal, model, reasoning };
}

// ゴミ箱へ移したページ ID の配列を確かめる（JSON 文字列でもよい）。
export function parseTrashedPageIds(value: unknown): string[] | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((item): item is string => typeof item === "string" && REVEAL_TARGET.test(item));
  return ids.length ? ids : null;
}

export function dispatchPagesTrashed(ids: string[]) {
  window.dispatchEvent(new CustomEvent<{ ids: string[]; preserveDrafts?: boolean }>(PAGES_TRASHED_EVENT, { detail: { ids, preserveDrafts: true } }));
}

export function createEmbedApi({ flush, draftKept = () => false, openHistory, pageUpdated = dispatchPageUpdated, pageSettings = dispatchPageMeta, appIcon = saveAppIcon, theme = saveThemePreference, slides = dispatchSlidesCommand, openPage, close, pageTrashed = dispatchPagesTrashed, language, reveal = () => {}, post }: {
  flush: () => Promise<boolean>;
  reveal?: (target: string) => void;
  language?: (locale: Locale) => Promise<boolean>;
  theme?: (value: ThemePreference) => unknown;
  draftKept?: () => boolean;
  openHistory: () => void;
  pageUpdated?: (page: NotePage) => void;
  pageSettings?: (page: PageMetaUpdate) => void;
  // 既定では web の設定と同じ場所（この WebView の localStorage）に書き、表示中のアイコンをその場で替える。
  appIcon?: (icon: string | null) => unknown;
  slides?: (command: SlidesCommand) => void;
  openPage?: (request: OpenPageRequest) => void;
  close?: () => void;
  pageTrashed?: (ids: string[]) => void;
  post: (message: NativeMessage) => void;
}): EmbedApi {
  return {
    async language(value) {
      if (!isLocale(value) || !language) return false;
      try { return await language(value); } catch { return false; }
    },
    theme(value) {
      const parsed = parseThemePreference(value);
      if (!parsed) return false;
      theme(parsed);
      return true;
    },
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
    reveal(value) {
      if (typeof value !== "string" || !REVEAL_TARGET.test(value)) return false;
      reveal(value);
      return true;
    },
    pageUpdated(value) {
      const page = parseUpdatedPage(value);
      if (!page) return false;
      pageUpdated(page);
      return true;
    },
    pageSettings(value) {
      const page = parsePageSettings(value);
      if (!page) return false;
      pageSettings(page);
      return true;
    },
    appIcon(value) {
      const icon = parseAppIcon(value);
      if (icon === undefined) return false;
      appIcon(icon);
      return true;
    },
    slides(value) {
      const command = parseSlidesCommand(value);
      if (!command) return false;
      slides(command);
      return true;
    },
    openPage(value) {
      if (!openPage) return false;
      const request = parseOpenPageRequest(value);
      if (!request) return false;
      openPage(request);
      return true;
    },
    close() {
      if (!close) return false;
      close();
      return true;
    },
    pageTrashed(value) {
      const ids = parseTrashedPageIds(value);
      if (!ids) return false;
      pageTrashed(ids);
      return true;
    },
  };
}

// window.notefableEmbed を置く。戻り値で外す（別の API に置き換わっていたら触らない）。
export function installEmbedApi(api: EmbedApi, target: BridgeWindow | undefined = browserWindow()) {
  if (!target) return () => {};
  target.notefableEmbed = api;
  return () => { if (target.notefableEmbed === api) delete target.notefableEmbed; };
}
