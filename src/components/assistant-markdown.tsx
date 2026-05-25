"use client";

import { Check, Copy } from "lucide-react";
import { isValidElement, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  // アシスタント回答のコードはそのまま使う場面が多い。
  // pre 全体をラップし、表示内容をクリップボードへコピーできる操作を追加する。
  const [copied, setCopied] = useState(false);
  // children から抽出したコード文字列。コピー時にこの値をクリップボードへ渡す。
  const code = getNodeText(children);

  async function copyCode() {
    // 空のコードブロックではクリップボード操作を行わない。
    if (!code) return;

    await navigator.clipboard.writeText(code);
    // コピー直後だけアイコンとラベルを変え、短時間で元へ戻す。
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-shell">
      <button
        type="button"
        className="markdown-code-copy"
        onClick={copyCode}
        aria-label={copied ? "Copied code" : "Copy code"}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check size={18} /> : <Copy size={20} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  // 回答中の HTML は ReactMarkdown 側で無効化し、必要な要素だけ表示を差し替える。
  // 外部リンクは新規タブ、コードはインライン/ブロックで別スタイルにする。
  a: ({ node, ...props }) => {
    void node;

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

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
}
