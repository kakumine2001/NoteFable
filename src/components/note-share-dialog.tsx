"use client";

import { Check, Copy, ExternalLink, Globe, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { expiryFromPreset, type ShareExpiryPreset } from "@/lib/note-share";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { NotePageSummary, NoteShareState } from "@/types/notes";

function toLocalDateTimeInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatExpiry(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function NoteShareDialog({
  pageId,
  beforePublish,
  onUpdated,
  onClose,
}: {
  pageId: string;
  beforePublish?: (includeSubpages: boolean) => Promise<boolean>;
  onUpdated?: (page: NotePageSummary) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [share, setShare] = useState<NoteShareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<"own" | "inherited" | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [lastPreset, setLastPreset] = useState<ShareExpiryPreset | null>(null);
  const [draftIncludeSubpages, setDraftIncludeSubpages] = useState(true);

  useBackToClose(true, onClose);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pages/${encodeURIComponent(pageId)}/share`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.share) throw new Error(data?.error || msg("Failed to load share settings."));
        if (!cancelled) {
          const loaded = data.share as NoteShareState;
          setShare(loaded);
          setDraftIncludeSubpages(loaded.includeSubpages);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : msg("Failed to load share settings."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  async function save(patch: {
    enabled?: boolean;
    includeSubpages?: boolean;
    expiresAt?: string | null;
    excludeFromParent?: boolean;
  }) {
    setBusy(true);
    setError("");
    try {
      if (patch.enabled === true && beforePublish) {
        const flushed = await beforePublish(patch.includeSubpages ?? share?.includeSubpages ?? true);
        if (!flushed) {
          setError(msg("Failed to update share settings."));
          return;
        }
      }
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/share`, {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.share) throw new Error(data?.error || msg("Failed to update share settings."));
      setShare(data.share as NoteShareState);
      if (data.page && onUpdated) onUpdated(data.page as NotePageSummary);
      setCustomMode(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : msg("Failed to update share settings."));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(url: string, key: "own" | "inherited") {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    } catch {
      setError(msg("Could not copy link."));
    }
  }

  function onPresetChange(preset: ShareExpiryPreset) {
    if (preset === "custom") {
      setCustomValue(toLocalDateTimeInput(share?.expiresAt ?? null));
      setCustomMode(true);
      setLastPreset("custom");
      return;
    }
    setCustomMode(false);
    setLastPreset(preset);
    void save({ expiresAt: expiryFromPreset(preset) });
  }

  function submitCustomExpiry() {
    if (!customValue) return;
    const parsed = new Date(customValue);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      setError(msg("Expiration time must be in the future."));
      return;
    }
    setLastPreset(null);
    void save({ expiresAt: parsed.toISOString() });
  }

  const selectValue = customMode ? "custom" : !share?.expiresAt ? "never" : lastPreset && lastPreset !== "custom" ? lastPreset : "active";

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-label={t("Share")}
      className="notes-dialog notes-share-dialog"
    >
      <div className="notes-share-head">
        <div className="notes-share-title">
          <Globe size={17} aria-hidden="true" />
          <h2>{t("Publish to web")}</h2>
        </div>
        <button type="button" className="notion-icon-button grid" aria-label={t("Close")} onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[var(--notion-muted)]">{t("Loading…")}</p>
      ) : share ? (
        <div className="notes-share-body">
          {share.inheritedFrom ? (
            <div className="notes-share-inherited">
              <p className="notes-share-inherited-text">
                {share.excludeFromParent
                  ? t("Excluded from parent share ({title})", { title: share.inheritedFrom.title || t("Untitled") })
                  : t("Shared via parent page ({title})", { title: share.inheritedFrom.title || t("Untitled") })}
              </p>
              {share.inheritedUrl ? (
                <div className="notes-share-url-row">
                  <input type="text" readOnly value={share.inheritedUrl} className="notes-share-url-input" aria-label={t("Public link")} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="notion-button notes-share-copy" onClick={() => void copyUrl(share.inheritedUrl!, "inherited")}>
                    {copiedKey === "inherited" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    <span>{copiedKey === "inherited" ? t("Copied") : t("Copy link")}</span>
                  </button>
                  <a href={share.inheritedUrl} target="_blank" rel="noopener noreferrer" className="notion-icon-button grid" aria-label={t("Open link")} title={t("Open link")}>
                    <ExternalLink size={16} />
                  </a>
                </div>
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={share.excludeFromParent}
                disabled={busy}
                className="notes-share-toggle"
                onClick={() => void save({ excludeFromParent: !share.excludeFromParent })}
              >
                <span className="flex-1 text-start">{t("Exclude from parent share")}</span>
                <span className="notes-menu-switch" data-on={share.excludeFromParent} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {!share.active ? (
            <div className="notes-share-inactive">
              {share.expired ? (
                <p className="notes-share-expired">{t("This share link has expired.")}</p>
              ) : (
                <p className="notes-share-desc">{t("Publish this note so anyone with the link can view it.")}</p>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={draftIncludeSubpages}
                disabled={busy}
                className="notes-share-toggle mb-2"
                onClick={() => setDraftIncludeSubpages((value) => !value)}
              >
                <span className="flex-1 text-start">{t("Include sub-pages")}</span>
                <span className="notes-menu-switch" data-on={draftIncludeSubpages} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={busy}
                className="notion-button notion-button-primary w-full justify-center"
                onClick={() => void save({ enabled: true, includeSubpages: draftIncludeSubpages })}
              >
                {share.expired ? t("Republish") : t("Publish")}
              </button>
            </div>
          ) : (
            <div className="notes-share-active">
              {share.url ? (
                <div className="notes-share-url-row">
                  <input type="text" readOnly value={share.url} className="notes-share-url-input" aria-label={t("Public link")} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="notion-button notes-share-copy" onClick={() => void copyUrl(share.url!, "own")}>
                    {copiedKey === "own" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    <span>{copiedKey === "own" ? t("Copied") : t("Copy link")}</span>
                  </button>
                  <a href={share.url} target="_blank" rel="noopener noreferrer" className="notion-icon-button grid" aria-label={t("Open link")} title={t("Open link")}>
                    <ExternalLink size={16} />
                  </a>
                </div>
              ) : null}

              <button
                type="button"
                role="switch"
                aria-checked={share.includeSubpages}
                disabled={busy}
                className="notes-share-toggle"
                onClick={() => void save({ includeSubpages: !share.includeSubpages })}
              >
                <span className="flex-1 text-start">{t("Include sub-pages")}</span>
                <span className="notes-menu-switch" data-on={share.includeSubpages} aria-hidden="true" />
              </button>

              <div className="notes-share-expiry">
                <div className="notes-share-expiry-row">
                  <label htmlFor="notes-share-expiry-select" className="notes-share-expiry-label">{t("Link expires")}</label>
                  <select
                    id="notes-share-expiry-select"
                    disabled={busy}
                    value={selectValue}
                    className="notes-share-select"
                    onChange={(event) => onPresetChange(event.target.value as ShareExpiryPreset)}
                  >
                    {selectValue === "active" && share.expiresAt ? (
                      <option value="active" disabled>{formatExpiry(share.expiresAt, locale)}</option>
                    ) : null}
                    <option value="never">{t("Never")}</option>
                    <option value="1h">{t("1 hour")}</option>
                    <option value="1d">{t("1 day")}</option>
                    <option value="7d">{t("7 days")}</option>
                    <option value="30d">{t("30 days")}</option>
                    <option value="custom">{t("Custom date…")}</option>
                  </select>
                </div>
                {share.expiresAt && !customMode ? (
                  <p className="notes-share-expiry-meta">
                    {t("Expires {time}", { time: formatExpiry(share.expiresAt, locale) })}
                  </p>
                ) : null}
                {customMode ? (
                  <div className="notes-share-custom-row">
                    <input
                      type="datetime-local"
                      value={customValue}
                      disabled={busy}
                      className="notes-share-datetime"
                      aria-label={t("Link expires")}
                      onChange={(event) => setCustomValue(event.target.value)}
                    />
                    <button type="button" disabled={busy || !customValue} className="notion-button notion-button-primary" onClick={submitCustomExpiry}>
                      {t("Set")}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="notes-share-footer">
                <button type="button" disabled={busy} className="notion-button notes-delete" onClick={() => void save({ enabled: false })}>
                  {t("Unpublish")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#b91c1c]">
          {localizeSystemText(error, t)}
        </p>
      ) : null}
    </dialog>
  );
}
