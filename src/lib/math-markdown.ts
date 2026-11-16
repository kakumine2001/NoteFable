// 回答の Markdown に含まれる数式（LaTeX）の書き方を、表示用の変換（remark-math）が読める形にそろえる。
// モデルは \( … \)・\[ … \] と $ … $・$$ … $$ のどちらでも書いてくる。前者を後者に直し、数式ではない「$」（金額など）は
// 文字として残るようにエスケープする。コード（``` のブロックと `…` のインライン）の中は触らない。
// prisma などに依存しない（画面側から読み込む）。

// 数式かもしれない記号があるか。無ければ、数式用のライブラリを読み込まない。
export function hasMath(markdown: string) {
  return /\$|\\\(|\\\[/.test(markdown);
}

// 1 つの並びを左から順に切り出す：インラインコード、\[…\]、\(…\)、$$…$$、\$、$…$、残りの「$」。
// $…$ は Pandoc と同じ決まりで数式とみなす：開く「$」の直後と閉じる「$」の直前が空白ではなく、閉じる「$」の直後が数字ではない
// （「$5 と $10」を数式にしない）。途中で改行しない。
const TOKENS = /(`+)[\s\S]*?\1|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$[\s\S]*?\$\$|\\\$|\$(?!\s)(?:\\[\s\S]|[^$\\\n])+?(?<!\s)\$(?!\d)|\$/g;

function normalizeText(text: string) {
  return text.replace(TOKENS, (match, ticks: string | undefined, display: string | undefined, inline: string | undefined, offset: number) => {
    if (ticks) return match;
    if (display !== undefined) {
      const body = display.trim();
      if (!body) return match;
      // 行頭（字下げだけの後）から始まり、行末で終わる \[…\] は、独立した数式のブロックにする。字下げ（リストの中など）は保つ。
      const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
      const indent = text.slice(lineStart, offset);
      const rest = text.slice(offset + match.length);
      const endsLine = /^[ \t]*(?:\n|$)/.test(rest);
      if (/^[ \t]*$/.test(indent) && endsLine) {
        return `$$\n${body.split("\n").map((line) => indent + line.trim()).join("\n")}\n${indent}$$`;
      }
      return `$$${body.replace(/\n+/g, " ")}$$`;
    }
    if (inline !== undefined) {
      const body = inline.trim();
      // 中に「$」や改行があると $…$ にできないので、そのままにする。
      return body && !/[$\n]/.test(body) ? `$${body}$` : match;
    }
    // 対にならない「$」は文字として出す。
    return match === "$" ? "\\$" : match;
  });
}

export function normalizeMath(markdown: string) {
  if (!hasMath(markdown)) return markdown;
  const lines = markdown.split("\n");
  const output: string[] = [];
  let pending: string[] = [];
  // 開いているコードブロックの囲み（``` か ~~~、開いたときと同じ文字で同じ長さ以上の行で閉じる）。
  let fence: { char: string; length: number } | null = null;
  const flush = () => {
    if (pending.length) output.push(normalizeText(pending.join("\n")));
    pending = [];
  };
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      output.push(line);
      if (marker && marker[0] === fence.char && marker.length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (marker) {
      flush();
      fence = { char: marker[0], length: marker.length };
      output.push(line);
      continue;
    }
    pending.push(line);
  }
  flush();
  return output.join("\n");
}
