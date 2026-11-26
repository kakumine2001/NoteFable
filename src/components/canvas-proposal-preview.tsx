"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import type { CanvasKind } from "@/lib/page-kinds";
import type { ProposalContentPayload, ProposalContentReason } from "@/lib/page-ai/proposals";
import { msg, type Translate } from "@/lib/i18n/translate";

// Excalidraw・SlideFrame は実際にキャンバス提案のプレビューを表示するときだけ動的読み込みする（静的ページを重くしない）。
const WhiteboardThumbnail = dynamic(() => import("@/components/whiteboard/whiteboard-thumbnail"), { ssr: false });
const SlidesProposalPreview = dynamic(() => import("@/components/slides/slides-proposal-preview"), { ssr: false });

type SideState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "loaded"; payload: ProposalContentPayload };

export function unavailableMessage(reason: ProposalContentReason | undefined, t: Translate): string {
  switch (reason) {
    case "version_mismatch":
      return t("Before preview unavailable — this page changed after the proposal was made.");
    case "deleted":
      return t("Before preview unavailable — this page was deleted.");
    case "revision_missing":
      return t("Before preview unavailable — the previous version is no longer kept.");
    case "discarded":
      return t("Before preview unavailable — this proposal was discarded.");
    default:
      return t("Before preview is not available.");
  }
}

function CanvasVisual({ kind, data, focusIds }: { kind: CanvasKind; data: unknown; focusIds?: readonly string[] }) {
  if (kind === "whiteboard") return <WhiteboardThumbnail data={data} />;
  return <SlidesProposalPreview data={data} focusIds={focusIds} />;
}

export function CanvasProposalPreview({
  proposalId,
  pageKind,
  proposalKind,
  status,
  mode = "card",
  onLoaded,
}: {
  proposalId: string;
  pageKind?: CanvasKind;
  proposalKind?: "proposal" | "create_proposal";
  status?: string;
  mode?: "card" | "embed";
  onLoaded?: (result: { before: ProposalContentPayload | null; after: ProposalContentPayload | null }) => void;
}) {
  const t = useT();
  const [before, setBefore] = useState<SideState>({ state: "loading" });
  const [after, setAfter] = useState<SideState>({ state: "loading" });
  const [tab, setTab] = useState<"compare" | "before" | "after">("compare");
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setBefore({ state: "loading" });
    setAfter({ state: "loading" });
    const fetchSide = async (side: "before" | "after"): Promise<ProposalContentPayload | null> => {
      const response = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/content?side=${side}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as ProposalContentPayload;
    };

    const [beforeResult, afterResult] = await Promise.all([
      fetchSide("before").catch(() => null),
      fetchSide("after").catch(() => null),
    ]);
    if (signal.aborted) return;
    setBefore(beforeResult ? { state: "loaded", payload: beforeResult } : { state: "error" });
    setAfter(afterResult ? { state: "loaded", payload: afterResult } : { state: "error" });
    onLoaded?.({ before: beforeResult, after: afterResult });
  }, [proposalId, onLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { void load(controller.signal); });
    return () => controller.abort();
  }, [load, status, reloadTick]);

  const resolvedKind: CanvasKind =
    (after.state === "loaded" ? after.payload.pageKind : undefined)
    ?? (before.state === "loaded" ? before.payload.pageKind : undefined)
    ?? pageKind
    ?? "whiteboard";

  const isCreate = proposalKind === "create_proposal"
    || (after.state === "loaded" && after.payload.kind === "create")
    || (before.state === "loaded" && before.payload.empty === true);

  const showTabs = !isCreate;
  const effectiveTab = isCreate ? "after" : tab;

  const renderBeforePane = () => {
    if (before.state === "loading") {
      return <p className="proposal-preview-status">{t("Loading preview…")}</p>;
    }
    if (before.state === "error") {
      return (
        <div className="proposal-preview-status">
          <span>{t("Could not load preview.")}</span>
          <button type="button" className="proposal-preview-retry" onClick={() => setReloadTick((n) => n + 1)}>{t("Try again")}</button>
        </div>
      );
    }
    const payload = before.payload;
    if (payload.empty) return null;
    if (payload.stale || payload.unavailable || !payload.data) {
      return <p className="proposal-preview-stale">{unavailableMessage(payload.reason, t)}</p>;
    }
    return <CanvasVisual kind={resolvedKind} data={payload.data} focusIds={payload.focusIds} />;
  };

  const renderAfterPane = () => {
    if (after.state === "loading") {
      return <p className="proposal-preview-status">{t("Loading preview…")}</p>;
    }
    if (after.state === "error") {
      return (
        <div className="proposal-preview-status">
          <span>{t("Could not load preview.")}</span>
          <button type="button" className="proposal-preview-retry" onClick={() => setReloadTick((n) => n + 1)}>{t("Try again")}</button>
        </div>
      );
    }
    const payload = after.payload;
    if (payload.unavailable || !payload.data) {
      return <p className="proposal-preview-stale">{t("Could not load preview.")}</p>;
    }
    return <CanvasVisual kind={resolvedKind} data={payload.data} focusIds={payload.focusIds} />;
  };

  return (
    <div className={`proposal-canvas-preview is-${mode}`} data-view={effectiveTab}>
      <div className="proposal-preview-toolbar">
        <span className="proposal-preview-heading">{t("Visual preview")}</span>
        {showTabs && (
          <div className="proposal-preview-tabs" role="tablist" aria-label={t("Visual preview")}>
            {(["compare", "before", "after"] as const).map((choice) => {
              const label = choice === "compare" ? msg("Compare") : choice === "before" ? msg("Before") : msg("After");
              return (
                <button
                  key={choice}
                  type="button"
                  role="tab"
                  aria-selected={effectiveTab === choice}
                  className={`proposal-preview-tab ${effectiveTab === choice ? "is-active" : ""}`}
                  onClick={() => setTab(choice)}
                >
                  {t(label)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={`proposal-preview-grid ${effectiveTab === "compare" ? "is-compare" : "is-single"}`}>
        {(effectiveTab === "compare" || effectiveTab === "before") && !isCreate && (
          <div className="proposal-preview-pane is-before">
            <div className="proposal-preview-pane-label">{t("Before")}</div>
            <div className="proposal-preview-pane-body">{renderBeforePane()}</div>
          </div>
        )}
        {(effectiveTab === "compare" || effectiveTab === "after") && (
          <div className="proposal-preview-pane is-after">
            <div className="proposal-preview-pane-label">{t("After")}</div>
            <div className="proposal-preview-pane-body">{renderAfterPane()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
