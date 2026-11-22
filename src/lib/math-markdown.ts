// 回答の Markdown に含まれる数式（LaTeX）の書き方を、表示用の変換（remark-math）が読める形にそろえる。
// モデルは \( … \)・\[ … \] と $ … $・$$ … $$ のどちらでも書いてくる。前者を後者に直し、独立した数式は
// 「$$ だけの行」で囲む形にそろえ、数式ではない「$」（金額など）は文字として残るようにエスケープする。
// コード（``` のブロックと `…` のインライン）とリンク先・URL の中は触らない。
// prisma などに依存しない（画面側から読み込む）。

export type PreparedMath = {
  // 数式用の変換（remark-math）へ渡す Markdown。数式が無いときは元のまま。
  text: string;
  // 数式が 1 つでもあるか。無ければ、数式用のライブラリを読み込まない（金額の「$」だけでは読み込まない）。
  hasMath: boolean;
};

// 空行をまたがない並び（数式もインラインコードも、段落をまたいでは続かない）。
const NO_BLANK_LINE = String.raw`(?:(?!\n[ \t>]*\n)[\s\S])*?`;

// 左から順に切り出す。前のものほど優先：
//  1. \\（エスケープされたバックスラッシュ）             → そのまま
//  2. `…`（インラインコード）                              → そのまま
//  3. ](…)（リンク先）・<https://…>・https://…（URL）      → そのまま
//  4. \[ … \]  5. \( … \)  6. $$ … $$                      → 数式
//  7. \$                                                    → そのまま
//  8. $ … $（Pandoc の決まり：開く $ の直後と閉じる $ の直前が空白ではなく、閉じる $ の直後が数字ではない。改行しない）
//  9. 残りの $                                              → 文字としてエスケープ
// \[ と \( は Markdown では「文字の [ と (」のエスケープでもある。英数字や [ の直後にあるもの（arr\[i\]、f\(x\)、[\[1\]](…)）は
// 数式とみなさない。
const TOKENS = new RegExp(
  [
    String.raw`(\\\\)`,
    String.raw`((?<!\`)(\`+)(?!\`)${NO_BLANK_LINE}(?<!\`)\3(?!\`))`,
    String.raw`(\]\((?:\\.|[^()\\\s]|\((?:\\.|[^()\\\s])*\))*(?:[ \t]+"[^"\n]*")?\)|<https?:[^>\s]+>|https?:\/\/[^\s<>]+)`,
    String.raw`(?<![A-Za-z0-9\[])\\\[(${NO_BLANK_LINE})\\\]`,
    String.raw`(?<![A-Za-z0-9])\\\((${NO_BLANK_LINE})\\\)`,
    String.raw`\$\$(${NO_BLANK_LINE})\$\$`,
    String.raw`(\\\$)`,
    String.raw`\$(?!\s)((?:\\[\s\S]|[^$\\\n])+?)(?<!\s)\$(?!\d)`,
    String.raw`(\$)`,
  ].join("|"),
  "g",
);

// 独立した数式。行頭（字下げ・引用の「>」だけの後）から始まり行末で終わるものは「$$ だけの行」で囲む：remark-math は
// そうなっていない $$ をブロックとして閉じられず、後ろの本文まで数式に飲み込む。字下げと「>」（リストや引用の中）は保つ。
// 文の途中にあるものは 1 行のインラインの数式にする。
function displayMath(text: string, offset: number, length: number, rawBody: string) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  const ownLines = /^[ \t>]*$/.test(prefix) && /^[ \t]*(?:\n|$)/.test(text.slice(offset + length));
  // 数式の各行から取るのは、行頭の字下げと、囲んでいる引用の「>」（前置きにある数だけ）。数式の中の「>」（不等号）は残す。
  const quotes = prefix.split(">").length - 1;
  const strip = new RegExp(String.raw`^[ \t]*(?:>[ \t]*){0,${quotes}}`);
  const lines = rawBody.split("\n").map((line) => line.replace(strip, "").trimEnd()).filter((line) => line.length > 0);
  if (!lines.length) return null;
  return ownLines
    ? `$$\n${lines.map((line) => prefix + line).join("\n")}\n${prefix}$$`
    : `$$${lines.join(" ")}$$`;
}

function prepareText(text: string, found: { math: boolean }) {
  return text.replace(TOKENS, (match, ...groups: unknown[]) => {
    const [escapedBackslash, code, , link, bracket, paren, dollars, escapedDollar, inline, lone] = groups as (string | undefined)[];
    const offset = groups[groups.length - 2] as number;
    if (escapedBackslash || code || link || escapedDollar) return match;
    if (bracket !== undefined) {
      // \[ \]・\[x\] は、エスケープされたチェックボックスの書き方。数式にしない。
      if (/^[ xX]?$/.test(bracket)) return match;
      const display = displayMath(text, offset, match.length, bracket);
      if (!display) return match;
      found.math = true;
      return display;
    }
    if (paren !== undefined) {
      const body = paren.replace(/\s*\n\s*/g, " ").trim();
      if (!body) return match;
      found.math = true;
      // 中に「$」（\$ も含む）があると $…$ では途中で閉じてしまうので、$$…$$ で囲む。
      return body.includes("$") ? `$$${body}$$` : `$${body}$`;
    }
    if (dollars !== undefined) {
      const display = displayMath(text, offset, match.length, dollars);
      if (!display) return match;
      found.math = true;
      return display;
    }
    if (inline !== undefined) {
      found.math = true;
      return inline.includes("$") ? `$$${inline}$$` : match;
    }
    // 対にならない「$」は文字として出す。
    return lone ? "\\$" : match;
  });
}

// コードブロックの囲み（CommonMark）：3 つ以上の ` か ~。` の囲みは、同じ行の後ろに ` があればインラインのコード。
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// 字下げのコードブロック：空行（または文頭・コードブロック）の後の、4 つ以上の空白かタブで始まる行。
// リストの中では、深い字下げは項目の続きや入れ子なので、コードとはみなさない。
const INDENTED = /^(?: {4,}| {0,3}\t)\s*\S/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

export function prepareMath(markdown: string): PreparedMath {
  if (!/\$|\\\(|\\\[|^ {0,3}(?:`{3,}|~{3,})\s*math\b/m.test(markdown)) return { text: markdown, hasMath: false };
  const found = { math: false };
  const output: string[] = [];
  let pending: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const flush = () => {
    if (pending.length) output.push(prepareText(pending.join("\n"), found));
    pending = [];
  };
  // 字下げのコードブロックを始められる位置か（直前が空行・文頭・コードブロックの終わり）。
  let afterBreak = true;
  let inList = false;
  let indentedCode = false;
  for (const line of markdown.split("\n")) {
    if (fence) {
      output.push(line);
      const closing = line.trim();
      if (closing.length >= fence.length && [...closing].every((char) => char === fence!.char)) {
        fence = null;
        afterBreak = true;
      }
      continue;
    }
    const blank = line.trim() === "";
    if (indentedCode) {
      // 空行をはさんでも、字下げが続くかぎりコード。
      if (blank || INDENTED.test(line)) {
        output.push(line);
        continue;
      }
      indentedCode = false;
      afterBreak = true;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      flush();
      fence = { char: open[1][0], length: open[1].length };
      // ```math のブロックは、表示の側（rehype-katex）が数式として描く。
      if (/^\s*math\b/.test(open[2])) found.math = true;
      output.push(line);
      continue;
    }
    if (afterBreak && !inList && INDENTED.test(line)) {
      flush();
      indentedCode = true;
      output.push(line);
      continue;
    }
    if (LIST_ITEM.test(line)) inList = true;
    else if (/^ ?\S/.test(line)) inList = false;
    afterBreak = blank;
    pending.push(line);
  }
  flush();
  // 数式が無ければ元のまま返す（remark-math を通さないので、「$」をエスケープする必要も無い）。
  return found.math ? { text: output.join("\n"), hasMath: true } : { text: markdown, hasMath: false };
}

export function hasMath(markdown: string) {
  return prepareMath(markdown).hasMath;
}

// ノートの履歴プレビュー用。ノートの Markdown（note-markdown.ts の blocksToMarkdown）では、文字としての $ は \$ と書かれ、
// 数式は $…$ と $$ の行で書かれる。そこで、コードの外に書かれた $（\$ ではないもの）が 1 つでもあれば数式がある、とみなす。
// [ や ( は文字としてエスケープされているので、\[ … \] や \( … \) は数式として読まない（prepareMath は通さない）。
export function hasDollarMath(markdown: string) {
  if (!markdown.includes("$")) return false;
  let fence: { char: string; length: number } | null = null;
  let afterBreak = true;
  let inList = false;
  let indentedCode = false;
  for (const line of markdown.split("\n")) {
    if (fence) {
      const closing = line.trim();
      if (closing.length >= fence.length && [...closing].every((char) => char === fence!.char)) {
        fence = null;
        afterBreak = true;
      }
      continue;
    }
    const blank = line.trim() === "";
    if (indentedCode) {
      if (blank || INDENTED.test(line)) continue;
      indentedCode = false;
      afterBreak = true;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    if (afterBreak && !inList && INDENTED.test(line)) {
      indentedCode = true;
      continue;
    }
    if (LIST_ITEM.test(line)) inList = true;
    else if (/^ ?\S/.test(line)) inList = false;
    afterBreak = blank;
    // バックスラッシュのエスケープとインラインコードを除いて、残った $ を数える。
    if (line.replace(/\\[\s\S]|(`+)[^`\n]*?\1/g, " ").includes("$")) return true;
  }
  return false;
}

export function normalizeMath(markdown: string) {
  return prepareMath(markdown).text;
}
