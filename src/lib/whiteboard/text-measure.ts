// 文字の幅の見積もり。ブラウザーの計測（canvas の measureText）が使えない場所で使う：サーバーでの図の変換（diagram.ts）と、
// 思考マップの配置（mindmap/layout.ts。サーバーとブラウザーで同じ配置になるよう、ブラウザーでも計測せずにこれを使う）。
// 中日韓の文字・全角記号・絵文字は 1 文字が字の大きさ（1em）、それ以外は 0.6em とする。白板の既定の字体（Nunito）と
// 中日韓の代わりの字体で実際に描くと、たいてい少し狭いので、枠からはみ出さない側に寄せた見積もりになる。

const NARROW_EM = 0.6;
const SPACE_EM = 0.32;

// 幅の広い文字（中日韓の文字・かな・ハングル・全角形・絵文字など）。
export function isWideCodePoint(cp: number) {
  return (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0x303e)
    || (cp >= 0x3041 && cp <= 0x33ff)
    || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x4e00 && cp <= 0x9fff)
    || (cp >= 0xa000 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1faff)
    || (cp >= 0x20000 && cp <= 0x3fffd);
}

function charWidth(char: string, fontSize: number) {
  const cp = char.codePointAt(0) ?? 0;
  if (char === " " || char === "\t") return fontSize * SPACE_EM;
  // 結合文字・異体字セレクター・ゼロ幅の文字は幅を持たない。
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200b || cp === 0x200d) return 0;
  return fontSize * (isWideCodePoint(cp) ? 1 : NARROW_EM);
}

// 1 行の幅（改行は見ない）。
export function estimateLineWidth(line: string, fontSize: number) {
  let width = 0;
  for (const char of line) width += charWidth(char, fontSize);
  return width;
}

// 複数行の文字の幅（いちばん長い行）。
export function estimateTextWidth(text: string, fontSize: number) {
  return Math.max(0, ...text.split("\n").map((line) => estimateLineWidth(line, fontSize)));
}

// 区切ってよい単位に分ける：中日韓の文字は 1 文字ずつ、それ以外は空白までのまとまり（後ろの空白を含める）。
function tokens(line: string): string[] {
  const out: string[] = [];
  let word = "";
  for (const char of line) {
    const cp = char.codePointAt(0) ?? 0;
    if (isWideCodePoint(cp)) {
      if (word) { out.push(word); word = ""; }
      out.push(char);
    } else if (char === " ") {
      out.push(`${word} `);
      word = "";
    } else {
      word += char;
    }
  }
  if (word) out.push(word);
  return out;
}

// maxWidth に収まるように折り返す。明示の改行は残す。1 語が maxWidth より長いときは文字の途中で切る。
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    let width = 0;
    const push = () => { lines.push(current.trimEnd()); current = ""; width = 0; };
    for (const token of tokens(paragraph)) {
      const tokenWidth = estimateLineWidth(token.trimEnd(), fontSize);
      if (current && width + tokenWidth > maxWidth) push();
      if (!current && tokenWidth > maxWidth) {
        // 長すぎる語は文字ごとに詰める。
        for (const char of token) {
          const w = charWidth(char, fontSize);
          if (current && width + w > maxWidth) push();
          if (!current && char === " ") continue;
          current += char;
          width += w;
        }
        continue;
      }
      if (!current && token.trim() === "") continue;
      current += token;
      width += estimateLineWidth(token, fontSize);
    }
    lines.push(current.trimEnd());
  }
  return lines;
}
