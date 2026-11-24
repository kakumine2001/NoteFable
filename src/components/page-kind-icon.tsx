"use client";

import { FileText, Presentation, Shapes, type LucideProps } from "lucide-react";
import { pageKindOf } from "@/lib/page-kinds";

// ページの種類の既定アイコン（ページに絵文字・画像のアイコンが無いときに出す）。ノートは FileText、ホワイトボードは Shapes、スライドは Presentation。
// Android（ui/Lucide.kt）と iOS（DesignSystem/Lucide.swift）も同じ図形を使う。kind が無い古い応答はノート。
export function PageKindIcon({ kind, className, ...props }: { kind?: unknown } & LucideProps) {
  const resolved = pageKindOf({ kind });
  const Icon = resolved === "whiteboard" ? Shapes : resolved === "slides" ? Presentation : FileText;
  return <Icon className={className ? `kind-icon kind-icon-${resolved} ${className}` : `kind-icon kind-icon-${resolved}`} {...props} />;
}
