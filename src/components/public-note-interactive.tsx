"use client";

import { Check, ChevronRight, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

export function PublicToggleBlock({
  header,
  children,
  className = "",
}: {
  header: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`public-note-toggle ${open ? "is-open" : ""} ${className}`}>
      <div className="public-note-toggle-row">
        <button
          type="button"
          className="public-note-toggle-btn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <div className="public-note-toggle-header">{header}</div>
      </div>
      {open && children ? <div className="public-note-children">{children}</div> : null}
    </div>
  );
}

export function PublicCodeBlock({
  code,
  language,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  language: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts.
    }
  }

  const label = language && language !== "text" ? language : "Plain Text";
  return (
    <div className="public-note-code" dir="ltr">
      <div className="public-note-code-bar">
        <span className="public-note-code-lang">{label}</span>
        <button type="button" className="public-note-code-copy" onClick={() => void onCopy()} aria-label={copied ? copiedLabel : copyLabel}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
