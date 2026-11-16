"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/components/i18n-provider";

// 画面の描画中に例外が起きたときの代わりの画面（app/[locale]/error.tsx と app/global-error.tsx が使う）。
// 境界がないと React は画面全体を外して真っ白な「Application error」になるため、ここで受け止めて再試行できるようにする。
// ブラウザの翻訳機能や拡張が DOM を書き換えて React の更新が失敗する場合もここに来る。
export function AppErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="app-error-screen" translate="no">
      <div className="app-error-card" role="alert">
        <h1>{t("Something went wrong")}</h1>
        <p>{t("This screen ran into a problem and stopped. Try again, or reload the page. If it keeps happening, try turning off page translation or browser extensions for this site.")}</p>
        <div className="app-error-actions">
          <button type="button" className="notion-button" onClick={() => window.location.reload()}>{t("Reload page")}</button>
          <button type="button" className="notion-button notion-button-primary" onClick={retry}>
            <RotateCw size={14} aria-hidden="true" />{t("Try again")}
          </button>
        </div>
      </div>
    </main>
  );
}
