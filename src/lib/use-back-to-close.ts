import { useEffect, useRef } from "react";

let nextSheetId = 1;

// シート（下から出るパネル）を開いている間は履歴を 1 件積み、端末の「戻る」でアプリを閉じずにシートだけ閉じる。
// 画面のボタンや Esc で閉じた場合は、自分が積んだ履歴だけを取り除く（別の画面遷移が積んだ履歴は触らない）。
export function useBackToClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const id = nextSheetId++;
    window.history.pushState({ studymateSheet: id }, "");
    let closedByBack = false;
    function onBack() {
      closedByBack = true;
      onCloseRef.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("popstate", onBack, { once: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("keydown", onKeyDown);
      if (!closedByBack && window.history.state?.studymateSheet === id) window.history.back();
    };
  }, [open]);
}
