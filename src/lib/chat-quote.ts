// 回答の一部を選んで「NoteFable に聞く」で引用したとき、引用は Markdown の引用ブロック（"> "）として
// 発言本文の先頭に入れて送る。サーバー・モデル・保存形式は普通の発言と同じで、表示側だけが先頭の引用を分けて描く。
// Android（data/ChatQuote.kt）も同じ書式で組み立て・分解する。

/** 引用として取り込む最大の文字数。長い選択は末尾を省く（モデルにはこの範囲だけ渡す）。 */
export const MAX_QUOTE_CHARS = 2_000;

/** 選んだ文字列を引用に整える。前後の空白を落とし、連続する空行は 1 行にし、長すぎれば切って "…" を付ける。 */
export function normalizeQuote(selection: string): string {
  const lines = selection.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const compact: string[] = [];
  for (const line of lines) {
    if (!line.trim() && (!compact.length || !compact.at(-1)!.trim())) continue;
    compact.push(line);
  }
  const text = compact.join("\n").trim();
  // 文字数は Android（ChatQuote.kt）と同じくコードポイントで数え、サロゲートペアの途中で切らない。
  const chars = Array.from(text);
  if (chars.length <= MAX_QUOTE_CHARS) return text;
  const clipped = chars.slice(0, MAX_QUOTE_CHARS).join("").trimEnd();
  return `${clipped}…`;
}

/** 引用と本文を、送信する 1 つの発言にする。引用が空なら本文だけ。 */
export function composeQuotedMessage(quote: string | null | undefined, body: string): string {
  const text = body.trim();
  const quoted = quote?.trim();
  if (!quoted) return text;
  const block = quoted.split("\n").map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
  return text ? `${block}\n\n${text}` : block;
}

/**
 * 発言の先頭にある引用ブロックを本文から分ける（composeQuotedMessage の逆）。
 * 引用の後に空行と本文が続くときだけ分ける。引用しかない発言や、途中に引用がある発言はそのまま本文として扱う。
 */
export function splitQuotedMessage(content: string): { quote: string | null; body: string } {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let end = 0;
  while (end < lines.length && /^>( |$)/.test(lines[end])) end++;
  if (!end || end >= lines.length || lines[end].trim()) return { quote: null, body: content };
  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) return { quote: null, body: content };
  const quote = lines.slice(0, end).map((line) => line.replace(/^> ?/, "")).join("\n").trim();
  if (!quote) return { quote: null, body: content };
  return { quote, body };
}
