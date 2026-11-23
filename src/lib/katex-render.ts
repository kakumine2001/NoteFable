// ノートの数式（mathBlock / mathInline）を KaTeX で HTML にする。
// エディター（note-math.tsx、ブラウザー）と公開ページ（public-note-view.tsx、サーバー）が同じ設定で描くよう、ここにまとめる。
// KaTeX 本体はどちらも呼ぶ側が必要な時だけ読み込んで渡す（このモジュールは KaTeX を import しない）。

export type KatexApi = {
  renderToString: (tex: string, options?: { displayMode?: boolean; throwOnError?: boolean; strict?: boolean; trust?: boolean; errorColor?: string }) => string;
};

export function renderKatex(katex: KatexApi, latex: string, displayMode: boolean): { html: string; error: string | null } {
  const source = latex.trim();
  if (!source) return { html: "", error: null };
  try {
    return {
      html: katex.renderToString(source, { displayMode, throwOnError: true, strict: false, trust: false }),
      error: null,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.replace(/^KaTeX parse error:\s*/i, "") : "Invalid equation";
    try {
      return {
        html: katex.renderToString(source, { displayMode, throwOnError: false, strict: false, trust: false, errorColor: "currentColor" }),
        error: message,
      };
    } catch {
      // 深い入れ子などで throwOnError: false でも失敗した時は、元の TeX をそのまま文字で出す。
      return { html: "", error: message };
    }
  }
}
