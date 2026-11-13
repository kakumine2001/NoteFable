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
