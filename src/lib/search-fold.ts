// 横断検索で表記ゆれを吸収するための「畳み込み」。
// 規則: NFKC（全角英数→半角、半角カナ→全角カナ、互換文字の統一）→ 小文字 → ひらがな→カタカナ → 引用符・ダッシュを ASCII に。
// JS 側（語・抜粋・ハイライト）はこの畳み込みで文字列を比べる。DB 側は本文を畳み込まず、語のほうを「その語に畳み込まれる元の表記すべて」に
// 広げた正規表現にして探す（termMatcher）。lower() + normalize(NFKC) + translate() を全行にかけると 3 MB で 6〜35 倍遅くなるため。
// prisma を読み込まない純粋なモジュールなので、ダイアログ（クライアント）からも import できる。

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
// ぁ〜ゖ と 繰り返し記号 ゝゞ。カタカナはちょうど 0x60 後ろにある。
const HIRAGANA_CODES = [...range(0x3041, 0x3096), 0x309d, 0x309e];
const KANA_OFFSET = 0x60;
const HIRAGANA_PATTERN = new RegExp(`[${String.fromCharCode(...HIRAGANA_CODES)}]`, "g");

// 組版用の引用符・ダッシュ。NFKC では ASCII にならないが、AI の回答や PDF では ’ や – で書かれ、検索では ' や - と打つ。
const TYPOGRAPHY = new Map<string, string>([
  ...[0x2018, 0x2019, 0x201a, 0x201b, 0x2032].map((code): [string, string] => [String.fromCharCode(code), "'"]),
  ...[0x201c, 0x201d, 0x201e, 0x201f, 0x2033].map((code): [string, string] => [String.fromCharCode(code), '"']),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code): [string, string] => [String.fromCharCode(code), "-"]),
]);
const TYPOGRAPHY_PATTERN = new RegExp(`[${[...TYPOGRAPHY.keys()].join("")}]`, "g");

// NFKC で前の文字と合成される文字。ここまでを 1 かたまりにして畳み込み、元の文字列の位置との対応を保つ。
// 結合文字、半角の濁点・半濁点、ハングル字母の母音・終声。
const CONTINUATION = /[\p{M}\u{1160}-\u{11ff}\u{d7b0}-\u{d7ff}\u{ff9e}\u{ff9f}]/u;

function foldCluster(cluster: string) {
  // ASCII 1 文字は NFKC で変わらない（長い英文でも normalize() を何千回も呼ばないための近道）。
  if (cluster.length === 1 && cluster.charCodeAt(0) < 0x80) return cluster.toLowerCase();
  return cluster
    .normalize("NFKC")
    .toLowerCase()
    .replace(HIRAGANA_PATTERN, (char) => String.fromCharCode(char.charCodeAt(0) + KANA_OFFSET))
    .replace(TYPOGRAPHY_PATTERN, (char) => TYPOGRAPHY.get(char) ?? char);
}

export type FoldMap = {
  folded: string;
  // folded[i] は元の文字列の [starts[i], ends[i]) から生まれた（UTF-16 の位置）。展開（㌔→キロ）や合成（ﾃ+ﾞ→デ）で長さが変わっても対応する。
  starts: Uint32Array;
  ends: Uint32Array;
};

export function foldWithMap(text: string): FoldMap {
  const starts: number[] = [];
  const ends: number[] = [];
  let folded = "";
  const flush = (from: number, to: number) => {
    const piece = foldCluster(text.slice(from, to));
    folded += piece;
    for (let index = 0; index < piece.length; index++) {
      starts.push(from);
      ends.push(to);
    }
  };
  let from = 0;
  let at = 0;
  for (const char of text) {
    // 結合する文字でなければ、ここまでのかたまりを確定して次を始める（先頭の文字は始めるだけ）。
    if (at > from && !CONTINUATION.test(char)) {
      flush(from, at);
      from = at;
    }
    at += char.length;
  }
  if (at > from) flush(from, at);
  return { folded, starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}

// 検索語の畳み込み。NUL は PostgreSQL の text に入らず、クエリが失敗するので取り除く。
export function foldSearchText(text: string): string {
  return foldWithMap(text).folded.replace(/\0/g, "");
}

// 1〜2 文字の英数字の語（"ai"、"a1"）は、単語の先頭でだけ一致させる（"detail" や "sustainable" の中の "ai" は拾わない）。
// 部分一致のままだと、2 文字の略語を打つたびにほとんどの英文が当たってしまう。日本語など ASCII 以外の語は、これまでどおり部分一致。
const SHORT_TERM = /^[a-z0-9]{1,2}$/;
export const isShortAsciiTerm = (term: string) => SHORT_TERM.test(term);

function startsAtWordHead(folded: string, at: number) {
  return at === 0 || !/[a-z0-9]/.test(folded[at - 1]);
}

// folded（畳み込み済み）の at の位置で語として一致してよいか。
function acceptsMatch(folded: string, at: number, term: string) {
  return !isShortAsciiTerm(term) || startsAtWordHead(folded, at);
}

// terms は畳み込み済み（parseSearchTerms の結果）。畳み込み済みの文字列に語がいくつ含まれるか（重複なしの語の数）。
function countTermsIn(folded: string, terms: string[]) {
  let count = 0;
  for (const term of terms) {
    if (!term) continue;
    for (let from = folded.indexOf(term); from >= 0; from = folded.indexOf(term, from + 1)) {
      if (acceptsMatch(folded, from, term)) {
        count++;
        break;
      }
    }
  }
  return count;
}

// text に含まれる語の数。表記ゆれ（全角・半角、ひらがな・カタカナ、大文字・小文字）を吸収して数える。
export function countMatchedTerms(text: string, terms: string[]) {
  return text ? countTermsIn(foldSearchText(text), terms) : 0;
}

export type TextRange = { start: number; end: number };

// text（元の文字列）の中で、語に一致した範囲を左から順に返す。重ならず、同じ位置では長い語を優先する。
// 一致は畳み込んだ文字列で探し、範囲は元の文字列の位置に直す。terms は畳み込み済み。
export function findTermRanges(text: string, terms: string[]): TextRange[] {
  const needles = [...new Set(terms)].filter(Boolean);
  if (!text || !needles.length) return [];
  const { folded, starts, ends } = foldWithMap(text);
  const found: TextRange[] = [];
  for (const needle of needles) {
    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
      if (acceptsMatch(folded, at, needle)) found.push({ start: at, end: at + needle.length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: TextRange[] = [];
  let cursor = 0;
  for (const match of found) {
    if (match.start < cursor) continue;
    cursor = match.end;
    const start = starts[match.start];
    const end = ends[match.end - 1];
    const last = ranges[ranges.length - 1];
    // 1 つの元の文字（㌔ など）から生まれた 2 つの一致は、元の文字の上では 1 つの範囲になる。
    if (last && start < last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

// 一致した語の周辺だけを返す。語が無いときは先頭。空白は 1 つにまとめる。表記ゆれで一致した場合も、元の文字のまま抜き出す。
const SNIPPET_CHARS = 160;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

export function buildSearchSnippet(body: string | null, terms: string[]) {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  const at = findTermRanges(text, terms)[0]?.start ?? 0;
  let start = Math.max(0, at - SNIPPET_CHARS / 4);
  let end = start + SNIPPET_CHARS;
  // サロゲートペア（絵文字など）を途中で切らない。
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start--;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end++;
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// ---- DB 側の照合（正規表現）----

// LIKE の % と _ を文字として扱う。エスケープ文字は SQL 側の ESCAPE '!' と合わせる。
export function likePattern(term: string) {
  return `%${term.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}
// 本文を畳み込む代わりに、語のほうを「その語に畳み込まれる元の表記すべて」に広げる。語の 1 文字ごとに、
//  ・同じ文字に畳み込まれる別の 1 文字（A/Ａ/ａ、2/２/²、ア/あ/ｱ、%/％ など）の集合
//  ・「元の字 + 結合記号」の 2 文字で書かれた形（ガ ← カ+゛、ｶ+ﾞ、か+゛。é ← e+´）
// のどちらかに当たる正規表現にする。集合は JS の畳み込み（foldCluster）から BMP を走査して作るので、JS 側の規則と食い違わない。
// NFKC が 1 文字を複数文字に展開するもの（㌔→キロ、㈱→(株) など）と BMP 外の文字は、DB の検索には当たらない（抜粋・ハイライトは JS で畳み込むので効く）。

// 走査しない範囲。NFKC・小文字化で変わらない大きなブロック（漢字・ハングル音節・私用領域）とサロゲート。
const STABLE_RANGES: [number, number][] = [[0xd800, 0xdfff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xac00, 0xd7a3], [0xe000, 0xf8ff]];
let sourceMap: Map<string, string[]> | null = null;

// 畳み込み後の 1 文字 → それに畳み込まれる、別の元の 1 文字。初回だけ 20ms ほどかけて作り、使い回す。
function foldSources() {
  if (sourceMap) return sourceMap;
  const map = new Map<string, string[]>();
  for (let code = 0; code <= 0xffff; code++) {
    if (STABLE_RANGES.some(([from, to]) => code >= from && code <= to)) continue;
    const raw = String.fromCharCode(code);
    const folded = foldCluster(raw);
    if (folded.length !== 1 || folded === raw) continue;
    const list = map.get(folded);
    if (list) list.push(raw);
    else map.set(folded, [raw]);
  }
  sourceMap = map;
  return map;
}

// 正規表現（PostgreSQL の ARE と JS の u フラグの両方で同じ意味になる範囲）の文字のエスケープ。英数字は \ を付けない（\d などの意味になるため）。
const escapeOutside = (char: string) => (/[\\^$.|?*+()[\]{}]/.test(char) ? `\\${char}` : char);
const escapeInside = (char: string) => (/[\\\][^-]/.test(char) ? `\\${char}` : char);

// その 1 文字（畳み込み後）になる元の表記の集合。別の表記が無ければそのままの 1 文字。
function classOf(char: string) {
  const sources = foldSources().get(char);
  return sources ? `[${[char, ...sources].map(escapeInside).join("")}]` : escapeOutside(char);
}

const COMBINING = /^\p{M}$/u;

function pieceOf(char: string) {
  const plain = classOf(char);
  const parts = [...char.normalize("NFD")];
  // ガ = カ + ゛、é = e + ´ のように、基本の字と結合記号に分けて書かれた形（半角カナの ｶﾞ もここに入る）。
  return parts.length === 2 && COMBINING.test(parts[1]) ? `(?:${plain}|${classOf(parts[0])}${classOf(parts[1])})` : plain;
}

let wordClass: string | null = null;

// 英数字（a-z、0-9）に畳み込まれる文字すべて。1〜2 文字の語の「単語の先頭」判定に使う。
function asciiWordClass() {
  if (wordClass) return wordClass;
  const sources = foldSources();
  const chars = [..."abcdefghijklmnopqrstuvwxyz0123456789"].flatMap((char) => [char, ...(sources.get(char) ?? [])]);
  wordClass = chars.map(escapeInside).join("");
  return wordClass;
}

// 濁点・半濁点（結合記号と半角）。語の最後の字が、これを付けて濁音になる字（カ→ガ）なら、直後にこれが続く本文には当てない
// （語「ガキ」が「ｶﾞｷﾞ」の ｶﾞ+ｷ に当たってしまうのを防ぐ）。
const VOICE_MARKS = String.fromCharCode(0x3099, 0x309a, 0xff9e, 0xff9f);
const canTakeMark = (char: string) => [0x3099, 0x309a].some((mark) => (char + String.fromCharCode(mark)).normalize("NFC").length === 1);

export type TermMatcher = {
  // true なら、他の表記が無い語（漢字など）で、LIKE '%語%' で足りる。false なら regex を使う。
  literal: boolean;
  // PostgreSQL の正規表現（~ で使う）。キャプチャ用の括弧は含まない。
  regex: string;
};

// terms は畳み込み済み。
export function termMatcher(term: string): TermMatcher {
  const chars = [...term];
  const pieces = chars.map(pieceOf);
  const short = isShortAsciiTerm(term);
  const literal = !short && chars.every((char, index) => pieces[index] === escapeOutside(char));
  const body = pieces.join("") + (chars.length && canTakeMark(chars[chars.length - 1]) ? `(?![${VOICE_MARKS}])` : "");
  return { literal, regex: short ? `(?:^|[^${asciiWordClass()}])${body}` : body };
}
