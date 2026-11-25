import { useEffect, useRef } from "react";

// 上限でログインを勧めたとき、送れなかった本文をログインの往復（ページ遷移・再読み込み）の間だけ預かる。
// 通常のウェブは同じタブの sessionStorage に置き、次に読み込んだ入力欄が 1 回だけ取り出す。
// アプリの WebView（/note-embed）はログイン成功時に WebView を作り直すため sessionStorage が消える。
// persistent: true のときは localStorage（2 時間の期限つき）に置き、同じページを開き直したときに戻す。添付ファイルは預からない。
const PREFIX = "notefable-pending-draft:";
const PERSISTENT_TTL_MS = 2 * 60 * 60 * 1000;

export type PendingDraftOptions = { persistent?: boolean; selectionIds?: string[] };

const SELECTION_SUFFIX = ":selection";

function storageOf(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? (window.localStorage ?? null) : (window.sessionStorage ?? null);
  } catch {
    return null;
  }
}

function readPersistentDraft(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; expiresAt?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      if (typeof parsed.expiresAt === "number" && Date.now() > parsed.expiresAt) return "";
      return parsed.text;
    }
  } catch {
    // 期限なしの旧形式文字列はそのまま扱う。
  }
  return raw;
}

function parseSelectionIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (() => {
            const record = parsed as { ids?: unknown; expiresAt?: unknown };
            if (typeof record.expiresAt === "number" && Date.now() > record.expiresAt) return [];
            return Array.isArray(record.ids) ? record.ids : [];
          })()
        : [];
    return list.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function savePendingDraftSelection(scope: string, ids: string[], options?: { persistent?: boolean }) {
  const key = PREFIX + scope + SELECTION_SUFFIX;
  const session = storageOf("session");
  const local = storageOf("local");
  const clean = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (!clean.length) {
    try { session?.removeItem(key); } catch { /* noop */ }
    try { local?.removeItem(key); } catch { /* noop */ }
    return;
  }
  if (options?.persistent && local) {
    try {
      local.setItem(key, JSON.stringify({ ids: clean, expiresAt: Date.now() + PERSISTENT_TTL_MS }));
      try { session?.removeItem(key); } catch { /* noop */ }
      return;
    } catch {
      // localStorage が使えないときは sessionStorage にフォールバックする。
    }
  }
  try {
    session?.setItem(key, JSON.stringify(clean));
    try { local?.removeItem(key); } catch { /* noop */ }
  } catch {
    // 保存できない環境では預からない。
  }
}

export function takePendingDraftSelection(scope: string): string[] {
  const key = PREFIX + scope + SELECTION_SUFFIX;
  let ids: string[] = [];
  const session = storageOf("session");
  if (session) {
    try {
      ids = parseSelectionIds(session.getItem(key));
      session.removeItem(key);
    } catch {
      ids = [];
    }
  }
  const local = storageOf("local");
  if (local) {
    try {
      const raw = local.getItem(key);
      local.removeItem(key);
      if (!ids.length) ids = parseSelectionIds(raw);
    } catch {
      // 保存できない環境ではそのまま。
    }
  }
  return ids;
}

export function savePendingDraft(scope: string, text: string, options?: PendingDraftOptions) {
  const key = PREFIX + scope;
  const session = storageOf("session");
  const local = storageOf("local");
  if (!text.trim()) {
    try { session?.removeItem(key); } catch { /* noop */ }
    try { local?.removeItem(key); } catch { /* noop */ }
    savePendingDraftSelection(scope, [], options);
    return;
  }
  if (options?.selectionIds !== undefined) {
    savePendingDraftSelection(scope, options.selectionIds, options);
  }
  if (options?.persistent && local) {
    try {
      local.setItem(key, JSON.stringify({ text, expiresAt: Date.now() + PERSISTENT_TTL_MS }));
      try { session?.removeItem(key); } catch { /* noop */ }
      return;
    } catch {
      // localStorage が使えないときは sessionStorage にフォールバックする。
    }
  }
  try {
    session?.setItem(key, text);
    try { local?.removeItem(key); } catch { /* noop */ }
  } catch {
    // 保存できない環境（プライベートモードなど）では預からない。
  }
}

export function takePendingDraft(scope: string) {
  const key = PREFIX + scope;
  let text = "";
  const session = storageOf("session");
  if (session) {
    try {
      text = session.getItem(key) ?? "";
      session.removeItem(key);
    } catch {
      text = "";
    }
  }
  const local = storageOf("local");
  if (local) {
    try {
      const raw = local.getItem(key);
      local.removeItem(key);
      if (!text) text = readPersistentDraft(raw);
    } catch {
      // 保存できない環境ではそのまま。
    }
  }
  return text;
}

// 上限に達したあとにページを離れるとき（どのログインボタンからでも、再読み込みでも）や入力欄が消えるとき、本文を預ける。
// getDraft が null を返す間（まだ上限に達していない）は何もしない。
// 戻り値は入力欄がまだ画面にあるか。応答を待つ間に画面が切り替わったら、呼び出し側は keepRejectedDraft で預ける。
export function useKeepDraftOnLeave(
  scope: string,
  getDraft: () => string | null,
  options?: { persistent?: boolean; getSelectionIds?: () => string[] },
) {
  const latest = useRef(getDraft);
  const latestSelection = useRef(options?.getSelectionIds);
  const mounted = useRef(false);
  const persistent = Boolean(options?.persistent);
  useEffect(() => {
    latest.current = getDraft;
    latestSelection.current = options?.getSelectionIds;
  });
  useEffect(() => {
    mounted.current = true;
    const onLeave = () => {
      const draft = latest.current();
      if (draft !== null) {
        savePendingDraft(scope, draft, {
          persistent,
          ...(latestSelection.current ? { selectionIds: latestSelection.current() } : {}),
        });
      }
    };
    window.addEventListener("pagehide", onLeave);
    // 画面の切り替え（別のノートへ移るなど）で入力欄ごと消えるときも預ける。
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, [scope, persistent]);
  return mounted;
}

// 入力欄が消えたあとに上限で断られた本文を預ける。先に預けた本文があれば、その前に足す。
export function keepRejectedDraft(scope: string, text: string, options?: PendingDraftOptions) {
  const existing = takePendingDraft(scope);
  const existingSelection = takePendingDraftSelection(scope);
  const selectionIds = options?.selectionIds?.length ? options.selectionIds : existingSelection;
  savePendingDraft(scope, existing.trim() ? [text.trimEnd(), existing].join("\n\n") : text, {
    ...options,
    ...(selectionIds.length ? { selectionIds } : {}),
  });
}
