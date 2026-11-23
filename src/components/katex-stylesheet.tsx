// KaTeX のスタイル（字体の @font-face を含む）だけを持つモジュール。
// 静的に import するとそのルートの全ページで CSS が読み込まれるので、必ず next/dynamic 経由で使う（public-note-math-styles.tsx）。
import "katex/dist/katex.min.css";

export default function KatexStylesheet() {
  return null;
}
