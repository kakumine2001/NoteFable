"use client";

import { useCallback, useState } from "react";
import { CanvasProposalPreview } from "@/components/canvas-proposal-preview";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { changeLabel } from "@/components/page-proposal";
import type { ProposalContentPayload } from "@/lib/page-ai/proposals";

// /note-embed?proposal=<id>：Android / iOS 原生アプリの提案カードから開く、キャンバス提案の改前・改後プレビュー画面。
// 静的ページ（src/app/[locale]/note-embed/page.tsx）のまま動作し、クライアント側で /api/proposals/[id]/content を取得する。
export function ProposalEmbedPreview({ proposalId }: { proposalId: string }) {
  const t = useT();
  const [meta, setMeta] = useState<ProposalContentPayload | null>(null);
  const [notFound, setNotFound] = useState(false);

  const handleLoaded = useCallback((result: { before: ProposalContentPayload | null; after: ProposalContentPayload | null; notFound: boolean }) => {
    const primary = result.after ?? result.before;
    if (result.notFound) {
      setNotFound(true);
      setMeta(null);
      return;
    }
    setNotFound(false);
    if (primary) setMeta(primary);
  }, []);

  const badge = meta?.status === "applied"
    ? (meta.kind === "create" ? t("Created") : t("Applied"))
    : meta?.status === "discarded"
      ? t("Discarded")
      : meta?.status === "undone"
        ? t("Undone")
        : "";

  const heading = meta
    ? meta.kind === "create"
      ? (meta.pageKind === "whiteboard"
        ? t("New whiteboard “{title}”", { title: meta.title })
        : t("New slide deck “{title}”", { title: meta.title }))
      : t("Proposed edit to “{title}”", { title: meta.pageTitle || meta.title })
    : t("Visual preview");

  return (
    <main className="proposal-embed-shell">
      <header className="proposal-embed-header">
        {meta && <PageKindIcon kind={meta.pageKind} size={16} aria-hidden="true" />}
        <h1 className="proposal-embed-title">{heading}</h1>
        {badge && <span className="page-edit-badge">{badge}</span>}
      </header>

      {notFound ? (
        <p className="proposal-preview-stale">{t("Proposal not found.")}</p>
      ) : (
        <>
          <CanvasProposalPreview
            proposalId={proposalId}
            pageKind={meta?.pageKind}
            proposalKind={meta?.kind === "create" ? "create_proposal" : meta ? "proposal" : undefined}
            mode="embed"
            onLoaded={handleLoaded}
          />

          {meta && (meta.titleDiff || meta.parentTitle !== undefined || meta.content || meta.changes.length > 0) && (
            <section className="proposal-embed-summary" aria-label={t("Proposed page edit")}>
              {meta.parentTitle !== undefined && (
                <div className="page-edit-op">{t("Inside “{title}”", { title: meta.parentTitle || t("Untitled") })}</div>
              )}
              {meta.titleDiff && (
                <div className="page-edit-change">
                  <div className="page-edit-op">{t("Rename")}</div>
                  <div className="page-edit-before">{meta.titleDiff.before}</div>
                  <div className="page-edit-after">{meta.titleDiff.after}</div>
                </div>
              )}
              {meta.content && (
                <div className="page-edit-change">
                  <div className="page-edit-after">{meta.content}</div>
                </div>
              )}
              {meta.changes.map((change, index) => (
                <div key={index} className="page-edit-change">
                  <div className="page-edit-op">{changeLabel(change, t, meta.pageKind)}</div>
                  {change.before !== undefined && <div className="page-edit-before">{change.before}</div>}
                  {change.after !== undefined && <div className="page-edit-after">{change.after}</div>}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
