"use client";

import { Check, Copy } from "lucide-react";
import { isValidElement, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function getNodeText(node: ReactNode): string {
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
  const [copied, setCopied] = useState(false);
  const code = getNodeText(children);

  async function copyCode() {
    if (!code) return;

    await navigator.clipboard.writeText(code);
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

    const value = String(children ?? "");
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
