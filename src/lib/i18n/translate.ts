export type Messages = Record<string, string>;
export type TranslateVars = Record<string, string | number>;
export type Translate = (text: string, vars?: TranslateVars) => string;

// 定数の表に置く文に印を付ける（そのまま返す）。表示するときに t() で訳す。辞書の検査はこの印も拾う。
export function msg<T extends string>(text: T): T {
  return text;
}

// 英語のまま保存・送信するシステム文だけを登録する。一般の UI 辞書から句型を推測しない。
// キーは 1 つの値だけを持ち、固定の先頭部分が互いに重ならないことをテストする。
export const SYSTEM_TEXT_TEMPLATES = [
  "A project can have at most {max} reference pages.",
  "Applied edits to “{title}”",
  "Claude response stopped: {reason}. Please retry.",
  "Created page “{title}”",
  "Enter 1 to {max} characters to search for.",
  "File is too large: {name}",
  "File is too long for one note: {name}",
  "Group names can have at most {max} characters.",
  "Instructions can have at most {max} characters.",
  "Model {model} does not support image uploads. Use GPT-6 Luna for images.",
  "Name must be 1–{max} characters with no control characters.",
  "Page title must be at most {max} characters.",
  "Previewed “{title}”",
  "Project names can have at most {max} characters.",
  "Proposed edits to “{title}”",
  "Proposed new note “{title}”",
  "Proposed new page “{title}”",
  "Read “{title}”",
  "Request failed: {detail}",
  "Scope must be one of: {scopes}.",
  "Searched pages for “{query}”",
  // 旧表記（保存済みのチャットの手順ラベル用。#205 で pages に改めた）。
  "Searched notes for “{query}”",
  "This version cannot be restored. {detail}",
  "Unsupported file type: {name}",
  "Upload failed: {name}. Please try again.",
  "Upload up to {max} files at a time.",
  "You can have at most {max} groups.",
  "You can import up to {max} files at once.",
] as const;

// 第 1 引数は上のシステム文のキー。返す文字列は英語で、翻訳が必要な場所だけ localizeSystemText を使う。
export function fmt(template: (typeof SYSTEM_TEXT_TEMPLATES)[number], vars: TranslateVars): string {
  return fill(template, vars);
}

function fill(template: string, vars: TranslateVars) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const systemPatterns = SYSTEM_TEXT_TEMPLATES.map((key) => {
  const [prefix, name, suffix] = key.split(/\{(\w+)\}/);
  return { key, name, regex: new RegExp(`^${escapeRegex(prefix)}([\\s\\S]*)${escapeRegex(suffix)}$`) };
});

// 明確なシステムエラー・ツールラベルにだけ使う。利用者の値は一切訳し直さない。
// 普通の UI 文字列・本文・ファイル名をこの関数に渡さない。
export function localizeSystemText(text: string, t: Translate): string {
  for (const pattern of systemPatterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const value = pattern.name === "detail" ? localizeSystemText(match[1], t) : match[1];
    return t(pattern.key, { [pattern.name]: value });
  }
  return t(text);
}

// 英語の文をキーに訳を引き、{name} を差し込む。訳がない文は英語のまま返す。
// 完成済みの文から変数やキーを推測しない。複数の値を持つ文字は常に t(key, vars) で訳す。
// 辞書はここで読み込まない（クライアントへ全言語の辞書を送らないため）。辞書は messages/index.ts から渡す。
export function createTranslator(messages: Messages): Translate {
  return (text, vars) => {
    const template = Object.hasOwn(messages, text) ? messages[text] : text;
    return vars ? fill(template, vars) : template;
  };
}
