import { useEffect, useRef } from "react";

// 上限でログインを勧めたとき、送れなかった本文をログインの往復（ページ遷移・再読み込み）の間だけ預かる。
// 同じタブの sessionStorage に置き、次に読み込んだ入力欄が 1 回だけ取り出す。添付ファイルは預からない。
const PREFIX = "studymate-pending-draft:";

export function savePendingDraft(scope: string, text: string) {
  try {
    if (text.trim()) window.sessionStorage.setItem(PREFIX + scope, text);
    else window.sessionStorage.removeItem(PREFIX + scope);
  } catch {
    // 保存できない環境（プライベートモードなど）では預からない。
  }
}

export function takePendingDraft(scope: string) {
  try {
    const text = window.sessionStorage.getItem(PREFIX + scope);
    window.sessionStorage.removeItem(PREFIX + scope);
    return text ?? "";
  } catch {
    return "";
  }
}

// 上限に達したあとにページを離れるとき（どのログインボタンからでも、再読み込みでも）や入力欄が消えるとき、本文を預ける。
// getDraft が null を返す間（まだ上限に達していない）は何もしない。
// 戻り値は入力欄がまだ画面にあるか。応答を待つ間に画面が切り替わったら、呼び出し側は keepRejectedDraft で預ける。
export function useKeepDraftOnLeave(scope: string, getDraft: () => string | null) {
  const latest = useRef(getDraft);
  const mounted = useRef(false);
  useEffect(() => {
    latest.current = getDraft;
  });
  useEffect(() => {
    mounted.current = true;
    const onLeave = () => {
      const draft = latest.current();
      if (draft !== null) savePendingDraft(scope, draft);
    };
    window.addEventListener("pagehide", onLeave);
    // 画面の切り替え（別のノートへ移るなど）で入力欄ごと消えるときも預ける。
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, [scope]);
  return mounted;
}

// 入力欄が消えたあとに上限で断られた本文を預ける。先に預けた本文があれば、その前に足す。
export function keepRejectedDraft(scope: string, text: string) {
  const existing = takePendingDraft(scope);
  savePendingDraft(scope, existing.trim() ? [text.trimEnd(), existing].join("\n\n") : text);
}
