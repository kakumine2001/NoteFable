export type Messages = Record<string, string>;
export type TranslateVars = Record<string, string | number>;
export type Translate = (text: string, vars?: TranslateVars) => string;

// 定数の表に置く文に印を付ける（そのまま返す）。表示するときに t() で訳す。辞書の検査はこの印も拾う。
export function msg<T extends string>(text: T): T {
  return text;
}

// 英語の文をキーに訳を引き、{name} を差し込む。訳がない文は英語のまま返す。
// 辞書はここで読み込まない（クライアントへ全言語の辞書を送らないため）。辞書は messages/index.ts から渡す。
export function createTranslator(messages: Messages): Translate {
  return (text, vars) => {
    const template = Object.hasOwn(messages, text) ? messages[text] : text;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
  };
}
