"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, LoaderCircle, Presentation, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { StorageLimitPrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg, type Translate } from "@/lib/i18n/translate";
import { nativeCanOpenPage, nativeCanShowPptxImport, nativeCanShowStorageLimit, postToNative } from "@/lib/native-bridge";
import {
  cancelPptxImport,
  clearPptxImportError,
  closePptxImport,
  getPptxImport,
  isPptxImportSaving,
  startPptxImport,
  subscribePptxImport,
  type PptxImportView,
} from "@/lib/pptx-import-jobs";
import type { PptxSlideIssue, PptxUnsupportedKind } from "@/lib/slides/pptx/types";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { NoteGroupSummary } from "@/types/notes";

// PowerPoint（.pptx）取り込みの小窓（web はダイアログ、スマホとアプリ WebView は全画面）。
// 変換に成功した時だけ 1 回建页し、非対応項目はページごとに一覧で知らせる（docs/architecture/slides.md）。

const ISSUE_LABELS: Record<PptxUnsupportedKind, string> = {
  chart: msg("Chart"),
  smartart: msg("SmartArt"),
  video: msg("Video"),
  audio: msg("Audio"),
  animation: msg("Animations"),
  transition: msg("Unsupported slide transition"),
  unsupportedImage: msg("Unsupported image format (EMF/WMF/SVG)"),
  externalImage: msg("External linked image"),
  oversizedImage: msg("Image exceeded size limit"),
  ole: msg("Embedded object"),
  elementLimit: msg("Extra elements beyond the slide limit were omitted"),
};

function formatIssue(issue: PptxSlideIssue, t: Translate): string {
  const base = t(ISSUE_LABELS[issue.kind]);
  const counted = issue.count > 1 && issue.kind !== "animation" ? `${base} ×${issue.count}` : base;
  if (issue.previewCount > 0) {
    return t("{item} (static preview placed)", { item: counted });
  }
  return counted;
}

export function PptxImportHost({ embedded = false, groups }: { embedded?: boolean; groups?: NoteGroupSummary[] }) {
  const view = useSyncExternalStore(subscribePptxImport, getPptxImport, () => null);
  const visible = view !== null;
  useEffect(() => {
    if (!embedded || !visible || !nativeCanShowPptxImport()) return;
    postToNative({ type: "pptxImport", state: "open" });
    return () => {
      postToNative({ type: "pptxImport", state: "closed" });
    };
  }, [embedded, visible]);
  if (!view) return null;
  return <PptxImportDialog key={view.key} view={view} embedded={embedded} initialGroups={groups} />;
}

function PptxImportDialog({ view, embedded, initialGroups }: { view: PptxImportView; embedded: boolean; initialGroups?: NoteGroupSummary[] }) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [dragging, setDragging] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(view.groupId ?? "");
  const [loadedGroups, setLoadedGroups] = useState<NoteGroupSummary[]>(initialGroups ?? []);
  const [closedStorageLimit, setClosedStorageLimit] = useState<unknown>(null);

  const canChooseProject = !view.fixedTarget;
  const isSaving = isPptxImportSaving(view);

  useBackToClose(true, () => { if (!isSaving) closePptxImport(); });
  useEffect(() => { dialogRef.current?.showModal(); }, []);

  // プロジェクト未指定で開いたときだけ一覧を読み込む（/note-embed では親から渡されないため）。
  useEffect(() => {
    if (!canChooseProject || initialGroups !== undefined) return;
    const controller = new AbortController();
    void fetch("/api/pages", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { groups?: NoteGroupSummary[] } | null;
        if (response.ok && Array.isArray(data?.groups)) setLoadedGroups(data.groups);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [canChooseProject, initialGroups]);

  const storageLimit = view.error?.storageLimit ?? null;
  useEffect(() => {
    if (!embedded || !storageLimit || !nativeCanShowStorageLimit()) return;
    postToNative({ type: "storageLimit", tier: storageLimit.tier, used: storageLimit.used, limit: storageLimit.limit });
  }, [embedded, storageLimit]);

  const groupsList = initialGroups ?? loadedGroups;
  const canOpen = !embedded || nativeCanOpenPage();
  const showStoragePrompt = Boolean(storageLimit) && view.error !== closedStorageLimit && (!embedded || !nativeCanShowStorageLimit());

  function pickFile(file: File | undefined | null) {
    if (!file) return;
    void startPptxImport(file, canChooseProject ? (selectedGroupId || null) : view.groupId);
  }

  function openCreated(id: string) {
    if (embedded) postToNative({ type: "openPage", id });
    else window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id } }));
    closePptxImport();
  }

  const percent = (() => {
    if (view.phase !== "working") return 0;
    const { stage, done, total } = view.progress;
    const frac = total > 0 ? Math.min(1, done / total) : 0;
    if (stage === "parsing") return Math.round(frac * 45);
    if (stage === "uploading") return 45 + Math.round(frac * 45);
    return 95;
  })();

  const progressText = (() => {
    const { stage, done, total } = view.progress;
    if (stage === "parsing") {
      return total > 1 ? t("Reading slides… ({done}/{total})", { done, total }) : t("Reading PowerPoint file…");
    }
    if (stage === "uploading") {
      return t("Uploading images… ({done}/{total})", { done, total });
    }
    return t("Creating slide deck…");
  })();

  return (
    <dialog
      ref={dialogRef}
      className="notes-dialog slides-wizard pptx-import-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!isSaving) closePptxImport(); }}
      onClick={(event) => { if (event.target === dialogRef.current && view.phase !== "working") closePptxImport(); }}
    >
      <div className="slides-wizard-header">
        <div className="flex min-w-0 items-center gap-2">
          <Presentation size={18} className="shrink-0 text-[var(--notion-muted)]" aria-hidden="true" />
          <h2 id={titleId} className="truncate text-[16px] font-semibold text-[var(--notion-text)]">{t("Import PowerPoint")}</h2>
        </div>
        <button type="button" className="notion-icon-button grid" aria-label={t("Close")} disabled={isSaving} onClick={() => closePptxImport()}>
          <X size={18} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          pickFile(picked);
        }}
      />

      {view.phase === "pick" && (
        <>
          <div className="slides-wizard-body">
            <div
              className={`pptx-import-dropzone${dragging ? " is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pickFile(event.dataTransfer.files?.[0]);
              }}
            >
              <Upload size={26} className="text-[var(--notion-muted)]" aria-hidden="true" />
              <p className="pptx-import-drop-title">{t("Choose a PowerPoint (.pptx) file")}</p>
              <p className="pptx-import-drop-hint">{t("Up to 50 MB and 200 slides.")}</p>
              <button
                type="button"
                data-autofocus
                className="notion-button notion-button-primary mt-2"
                onClick={() => inputRef.current?.click()}
              >
                {t("Choose file")}
              </button>
            </div>

            {canChooseProject && groupsList.length > 0 && (
              <label className="slides-wizard-field mt-4">
                <span className="slides-wizard-label">{t("Project")}</span>
                <select
                  className="notes-dialog-input"
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(event.target.value)}
                >
                  <option value="">{t("No project")}</option>
                  {groupsList.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="pptx-import-limits mt-4">
              <p className="pptx-import-limits-title">{t("Compatibility notes")}</p>
              <ul className="pptx-import-limits-list">
                <li>{t("Editable text, common shapes, lines, images, basic tables, speaker notes and hidden slides are imported into a new slide deck.")}</li>
                <li>{t("Charts, SmartArt, videos, animations and EMF/WMF/SVG images are listed per slide after import; static preview images are kept when included.")}</li>
                <li>{t("Images are uploaded to your workspace storage and count toward your storage limit.")}</li>
              </ul>
            </div>
          </div>
          <div className="slides-wizard-footer">
            <button type="button" className="notion-button" onClick={() => closePptxImport()}>{t("Cancel")}</button>
          </div>
        </>
      )}

      {view.phase === "working" && (
        <>
          <div className="slides-wizard-body">
            <div className="pptx-import-progress" role="status" aria-live="polite">
              <div className="flex items-center gap-2.5 text-sm font-medium text-[var(--notion-text)]">
                <LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden="true" />
                <span>{progressText}</span>
              </div>
              {view.fileName && <p className="mt-1.5 truncate text-xs text-[var(--notion-muted)]">{view.fileName}</p>}
              <div className="slides-wizard-progress-track" aria-hidden="true">
                <div className="slides-wizard-progress-fill" style={{ width: `${percent}%` }} />
              </div>
            </div>
          </div>
          <div className="slides-wizard-footer">
            <button type="button" className="notion-button" disabled={isSaving} onClick={() => cancelPptxImport()}>{t("Cancel")}</button>
          </div>
        </>
      )}

      {view.phase === "error" && (
        <>
          <div className="slides-wizard-body">
            <p role="alert" className="text-sm text-[var(--nf-danger,#b91c1c)]">
              {localizeSystemText(view.error?.message ?? "", t)}
            </p>
            {showStoragePrompt && storageLimit && (
              <div className="mt-3">
                <StorageLimitPrompt limit={storageLimit} actions={!embedded} className="" onClose={() => setClosedStorageLimit(view.error)} />
              </div>
            )}
          </div>
          <div className="slides-wizard-footer">
            <button type="button" className="notion-button" onClick={() => closePptxImport()}>{t("Close")}</button>
            <button type="button" data-autofocus className="notion-button notion-button-primary" onClick={() => clearPptxImportError()}>
              {t("Choose another file")}
            </button>
          </div>
        </>
      )}

      {view.phase === "done" && view.result && (
        <>
          <div className="slides-wizard-body">
            <div className="pptx-import-summary" role="status">
              <CheckCircle2 size={18} className="shrink-0 text-[var(--nf-accent)]" aria-hidden="true" />
              <p className="text-sm text-[var(--notion-text)]">
                {t("Imported “{title}” ({count} slides).", { title: view.result.page.title, count: view.result.report.slideCount })}
              </p>
            </div>

            {view.result.report.slides.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--notion-muted)]">
                {t("No unsupported items were found.")}
              </p>
            ) : (
              <div className="pptx-import-report mt-4">
                <div className="pptx-import-report-head">
                  <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                  <span>{t("Unsupported items by slide ({count})", { count: view.result.report.totalUnsupported })}</span>
                </div>
                {view.result.report.totalPreviews > 0 && (
                  <p className="pptx-import-report-note">
                    {t("Static preview images were placed where available.")}
                  </p>
                )}
                <ul className="pptx-import-report-list">
                  {view.result.report.slides.map((entry) => (
                    <li key={entry.slideNumber} className="pptx-import-report-slide">
                      <div className="pptx-import-report-slide-title">
                        <span>{t("Slide {number}", { number: entry.slideNumber })}</span>
                        {entry.slideTitle && <span className="pptx-import-report-snippet">· {entry.slideTitle}</span>}
                      </div>
                      <ul className="pptx-import-report-issues">
                        {entry.issues.map((issue) => (
                          <li key={issue.kind}>{formatIssue(issue, t)}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="slides-wizard-footer">
            <button type="button" data-autofocus={canOpen ? undefined : true} className="notion-button" onClick={() => closePptxImport()}>
              {t("Close")}
            </button>
            {canOpen && (
              <button type="button" data-autofocus className="notion-button notion-button-primary inline-flex items-center gap-1.5" onClick={() => openCreated(view.result!.page.id)}>
                <span>{t("Open slides")}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
