"use client";

import { Check, Code2, Copy } from "lucide-react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { isValidElement, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { msg } from "@/lib/i18n/translate";
import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareMath } from "@/lib/math-markdown";
import { writeClipboardText } from "@/lib/clipboard";
import { useT } from "@/components/i18n-provider";

const highlightLanguages = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["markdown", markdown],
  ["php", php],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["sql", sql],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
] as const;

for (const [language, definition] of highlightLanguages) {
  if (!hljs.getLanguage(language)) {
    hljs.registerLanguage(language, definition);
  }
}

const highlightLanguageIds = highlightLanguages.map(([language]) => language);

const languageAliases: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const languageLabels: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  php: "PHP",
  plaintext: msg("Code"),
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "HTML",
  yaml: "YAML",
};

function getNodeText(node: ReactNode): string {
  // ReactMarkdown の children は文字列だけでなく React 要素の入れ子になる。
  // コードブロックのコピーでは表示テキストだけが必要なので、再帰的に文字列へ戻す。
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getNodeText(node.props.children);
  }

  return "";
}

function getNodeLanguage(node: ReactNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const language = getNodeLanguage(child);
      if (language) return language;
    }
  }

  if (isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    const match = node.props.className?.match(/language-([\w#+.-]+)/);
    if (match?.[1]) return match[1];

    return getNodeLanguage(node.props.children);
  }

  return null;
}

function normalizeLanguage(language: string | null) {
  if (!language) return null;

  const normalized = language.toLowerCase().replace(/^language-/, "");
  return languageAliases[normalized] ?? normalized;
}

function guessLanguage(code: string) {
  if (
    /^\s*(def|class)\s+\w+/m.test(code) ||
    /^\s*(from|import)\s+\w+/m.test(code) ||
    /\b(input|print)\s*\(/.test(code)
  ) {
    return "python";
  }

  return null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightCode(code: string, language: string | null) {
  const explicitLanguage = normalizeLanguage(language);
  const guessedLanguage = explicitLanguage ?? guessLanguage(code);

  if (guessedLanguage && hljs.getLanguage(guessedLanguage)) {
    const result = hljs.highlight(code, {
      language: guessedLanguage,
      ignoreIllegals: true,
    });

    return {
      html: result.value,
      language: guessedLanguage,
      label: languageLabels[guessedLanguage] ?? guessedLanguage,
    };
  }

  const result = hljs.highlightAuto(code, highlightLanguageIds);
  const detectedLanguage =
    result.language && result.relevance >= 2 ? result.language : "plaintext";

  return {
    html: detectedLanguage === "plaintext" ? escapeHtml(code) : result.value,
    language: detectedLanguage,
    label: languageLabels[detectedLanguage] ?? detectedLanguage,
  };
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const t = useT();
  // アシスタント回答のコードはそのまま使う場面が多い。
  // pre 全体をラップし、言語表示・高亮・コピー操作をまとめて扱う。
  const [copied, setCopied] = useState(false);
  // children から抽出したコード文字列。コピー時にこの値をクリップボードへ渡す。
  const code = getNodeText(children);
  const highlighted = highlightCode(code, getNodeLanguage(children));

  async function copyCode() {
    // 空のコードブロックではクリップボード操作を行わない。
    if (!code) return;

    const copiedCode = await writeClipboardText(code);
    if (!copiedCode) return;

    // コピー直後だけアイコンとラベルを変え、短時間で元へ戻す。
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-shell">
      <div className="markdown-code-header">
        <span className="markdown-code-language">
          <Code2 size={15} strokeWidth={2.2} />
          {t(highlighted.label)}
        </span>
        <button
          type="button"
          className="markdown-code-copy"
          onClick={copyCode}
          aria-label={copied ? t("Copied code") : t("Copy code")}
          title={copied ? t("Copied") : t("Copy")}
        >
          {copied ? <Check size={18} /> : <Copy size={20} />}
        </button>
      </div>
      <pre>
        <code
          className={`hljs language-${highlighted.language}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  // 回答中の HTML は ReactMarkdown 側で無効化し、必要な要素だけ表示を差し替える。
  // 外部リンクは新規タブ、コードはインライン/ブロックで別スタイルにする。
  a: ({ node, ...props }) => {
    void node;
    // ノートの「@」メンション（[@タイトル](page:ID)・[@日付](date:…)）。履歴のプレビューや、ノートを読んだ回答に出る。リンクにはしない。
    if (typeof props.href === "string" && /^(page|date):/.test(props.href)) return <span className="markdown-mention">{props.children}</span>;

    return <a {...props} target="_blank" rel="noreferrer" />;
  },
  pre: ({ node, children }) => {
    void node;

    return <MarkdownCodeBlock>{children}</MarkdownCodeBlock>;
  },
  code: ({ node, className, children, ...props }) => {
    void node;

    // ReactMarkdown から来る children を文字列化して、末尾改行の調整に使う。
    const value = String(children ?? "");
    // 言語 className がある、または改行を含むものはブロックコードとして扱う。
    const isBlock = className || value.includes("\n");

    if (!isBlock) {
      return (
        <code className="markdown-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className={className} {...props}>
        {value.replace(/\n$/, "")}
      </code>
    );
  },
};

// 数式（LaTeX）の表示。KaTeX は大きいので、数式を含む回答が出たときに初めて読み込む（スタイルと字体も一緒）。
// 読み込みが済むまでは数式を書かれたままの文字で出し、済んだら、表示中のすべての回答を描き直す。
type MathPlugins = { remark: NonNullable<Options["remarkPlugins"]>; rehype: NonNullable<Options["rehypePlugins"]> };
let mathPlugins: MathPlugins | null = null;
let mathLoading: Promise<void> | null = null;
const mathListeners = new Set<() => void>();

function subscribeMath(listener: () => void) {
  mathListeners.add(listener);
  return () => { mathListeners.delete(listener); };
}

function loadMathPlugins() {
  if (mathPlugins || mathLoading) return;
  mathLoading = Promise.all([import("remark-math"), import("rehype-katex"), import("katex/dist/katex.min.css")])
    .then(([remarkMath, rehypeKatex]) => {
      mathPlugins = {
        remark: [remarkGfm, [remarkMath.default, { singleDollarTextMath: true }]],
        // 書き間違いの数式は例外にせず、書かれたままの文字を出す（回答の残りは読めるように）。
        rehype: [[rehypeKatex.default, { throwOnError: false, strict: false, errorColor: "currentColor" }]],
      };
      mathListeners.forEach((listener) => listener());
    })
    .catch(() => {
      // 読み込めなかったら、少し待ってもう一度試す（数式のある回答が表示されている間）。
      mathLoading = null;
      if (mathListeners.size) window.setTimeout(() => { if (mathListeners.size) loadMathPlugins(); }, 5000);
    });
}

const plainRemarkPlugins = [remarkGfm];

// math を false にすると数式として読まない（ノートの履歴の表示用：ノートの Markdown は [ や ( を \[ \( と書き出すので、
// 数式と紛れる。ノートの編集画面も数式を描かない）。
export function AssistantMarkdown({ content, math: mathEnabled = true }: { content: string; math?: boolean }) {
  // \( … \)・\[ … \] を $ … $ にそろえ、独立した数式を $$ の行で囲み、数式ではない「$」をエスケープする。
  const prepared = useMemo(() => (mathEnabled ? prepareMath(content) : null), [content, mathEnabled]);
  const needsMath = prepared?.hasMath ?? false;
  // 数式のある回答だけが読み込みの完了を待つ（無い回答は、読み込まれても描き直さない）。
  const math = useSyncExternalStore(needsMath ? subscribeMath : subscribeNothing, () => mathPlugins, () => null);
  useEffect(() => {
    if (needsMath) loadMathPlugins();
  }, [needsMath]);
  const useMath = needsMath && math !== null;
  // 数式が後から描かれると回答の高さが変わる。最下部を見ている会話が、その分だけ上に取り残されないよう知らせる。
  useLayoutEffect(() => {
    if (useMath) window.dispatchEvent(new Event(ANSWER_RESIZED_EVENT));
  }, [useMath]);

  return (
    <ReactMarkdown
      remarkPlugins={useMath ? math.remark : plainRemarkPlugins}
      rehypePlugins={useMath ? math.rehype : undefined}
      components={markdownComponents}
      urlTransform={keepMentionUrls}
      skipHtml
    >
      {useMath && prepared ? prepared.text : content}
    </ReactMarkdown>
  );
}

// 既定の変換は page: / date: を空にするので、メンションと見分けられるよう残す（a で文字として描く）。
function keepMentionUrls(url: string) {
  return /^(page|date):[\w-]+$/.test(url) ? url : defaultUrlTransform(url);
}

function subscribeNothing() {
  return () => {};
}

// 回答の高さが、メッセージの追加以外の理由で変わったときに window へ投げるイベント。
export const ANSWER_RESIZED_EVENT = "notefable:answer-resized";
