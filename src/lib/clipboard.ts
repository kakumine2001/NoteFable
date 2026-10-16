// テキストをクリップボードへ書く。非セキュアなコンテキストや、権限を拒否するアプリ内ブラウザでは execCommand に切り替える。
// コードブロックのコピーと回答のコピーで共有する。成功したら true。
export async function writeClipboardText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // in-app browser では async clipboard が拒否されることがある。
  }

  // 選択のためにフォーカスが移るので、終わったら元の要素へ戻す（キーボード操作でコピーしても位置を見失わない）。
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
}
