"use client";

import { newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useState } from "react";
import { effectivePageCardOf, pageCardLabel, pageCardMissingLabel, type PageCardPreview } from "@/lib/whiteboard/links";

// ホワイトボード上のページカード：
// 1. 取得した最新の題名・アイコン（または「ページ不存在」）をカードの文字要素へ反映する（syncPageCardElements）。
//    要約はここには書き込まない（白板 JSON・書き出し・検索へ漏らさないため）。
// 2. 要約（summary）は表示専用のオーバーレイ（PageCardOverlay）でカードの直下に重ねて見せる。

export type CardSyncLabels = {
  untitled: string;
  missing: string;
};

type TextElementLike = ExcalidrawElement & {
  type: "text";
  text: string;
  originalText: string;
  containerId: string | null;
};

// 取得したプレビュー情報に合わせて、生きているページカードの文字要素（と種別）を更新する。
// 変化が無ければ changed: false を返し、無駄な保存や描画を起こさない。
export function syncPageCardElements(
  elements: readonly ExcalidrawElement[],
  previews: Readonly<Record<string, PageCardPreview | null | undefined>>,
  labels: CardSyncLabels,
): { elements: ExcalidrawElement[]; changed: boolean } {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const patches = new Map<string, Record<string, unknown>>();
  const cardByTextId = new Map<string, { cardEl: ExcalidrawElement; nextLabel: string }>();

  for (const element of elements) {
    if (element.isDeleted) continue;
    const card = effectivePageCardOf(element);
    if (!card || !Object.hasOwn(previews, card.id)) continue;
    const preview = previews[card.id];
    if (preview === undefined) continue;

    const nextLabel = preview ? pageCardLabel(preview, labels.untitled) : pageCardMissingLabel(labels.missing);

    if (preview && preview.kind !== card.kind) {
      patches.set(element.id, {
        customData: { ...(element.customData ?? {}), notefablePage: { id: card.id, kind: preview.kind } },
      });
    }

    const boundTextId = element.boundElements?.find((entry) => entry.type === "text")?.id;
    const boundText = (boundTextId ? byId.get(boundTextId) : undefined)
      ?? elements.find((entry) => !entry.isDeleted && entry.type === "text" && (entry as TextElementLike).containerId === element.id);

    if (boundText && !boundText.isDeleted && boundText.type === "text") {
      const textEl = boundText as TextElementLike;
      if ((textEl.originalText ?? textEl.text) !== nextLabel) {
        cardByTextId.set(textEl.id, { cardEl: element, nextLabel });
      }
    }
  }

  for (const [textId, { cardEl, nextLabel }] of cardByTextId) {
    const textEl = byId.get(textId) as TextElementLike | undefined;
    if (!textEl) continue;
    const [, fitted] = restoreElements(
      [cardEl, { ...textEl, text: nextLabel, originalText: nextLabel }] as never,
      null,
      { refreshDimensions: true, repairBindings: true },
    ) as unknown as ExcalidrawElement[];
    if (!fitted || fitted.id !== textId || fitted.type !== "text") continue;
    const neededHeight = Math.ceil(fitted.height + 24);
    const nextHeight = Math.max(cardEl.height, neededHeight);
    if (nextHeight > cardEl.height + 0.5) {
      patches.set(cardEl.id, { ...(patches.get(cardEl.id) ?? {}), height: nextHeight });
    }
    patches.set(textId, {
      text: fitted.text,
      originalText: nextLabel,
      width: fitted.width,
      height: fitted.height,
      x: cardEl.x + Math.max(10, Math.min(12, (cardEl.width - fitted.width) / 2)),
      y: cardEl.y + (nextHeight - fitted.height) / 2,
    });
  }

  if (!patches.size) return { elements: elements as ExcalidrawElement[], changed: false };
  const next = elements.map((element) => {
    const patch = patches.get(element.id);
    return patch ? newElementWith(element, patch as never) : element;
  });
  return { elements: next, changed: true };
}

type View = { scrollX: number; scrollY: number; zoom: number; width: number; height: number };

const MIN_SUMMARY_ZOOM = 0.45;
const MAX_VISIBLE_CARD_OVERLAYS = 50;

// ページカードの直下にリアルタイムの短い要約を表示する（pointer-events: none、編集・公開共用）。
// 要約は白板 JSON・書き出し・検索には入らず、画面で見るときだけ重ねて表示する。
export function PageCardOverlay({
  api,
  previews,
  sceneVersion,
  hidden = false,
}: {
  api: ExcalidrawImperativeAPI;
  previews: Readonly<Record<string, PageCardPreview | null | undefined>>;
  sceneVersion: string;
  hidden?: boolean;
}) {
  const [view, setView] = useState<View>(() => {
    const state = api.getAppState();
    return { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height };
  });

  useEffect(() => {
    const sync = () => {
      const state = api.getAppState();
      setView({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height });
    };
    sync();
    return api.onScrollChange((scrollX, scrollY, zoom) => {
      const state = api.getAppState();
      setView({ scrollX, scrollY, zoom: zoom.value, width: state.width, height: state.height });
    });
  }, [api]);

  const items = useMemo(() => {
    if (hidden || view.zoom < MIN_SUMMARY_ZOOM) return [];
    const elements = api.getSceneElements();
    const out: { id: string; left: number; top: number; width: number; summary: string }[] = [];
    const margin = 120;
    for (const element of elements) {
      if (element.isDeleted) continue;
      const card = effectivePageCardOf(element);
      if (!card) continue;
      const preview = previews[card.id];
      if (!preview?.summary) continue;
      const left = (element.x + view.scrollX) * view.zoom;
      const top = (element.y + element.height + view.scrollY) * view.zoom + 4;
      const width = Math.max(160, Math.min(360, element.width * view.zoom));
      if (view.width > 0 && (left + width < -margin || left > view.width + margin)) continue;
      if (view.height > 0 && (top + 80 < -margin || top > view.height + margin)) continue;
      out.push({ id: element.id, left, top, width, summary: preview.summary });
      if (out.length >= MAX_VISIBLE_CARD_OVERLAYS) break;
    }
    return out;
  // sceneVersion 変化時にも Excalidraw の最新要素座標を読み直す。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, hidden, previews, sceneVersion, view]);

  if (!items.length) return null;

  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          className="whiteboard-card-summary"
          style={{ left: item.left, top: item.top, width: item.width }}
        >
          {item.summary}
        </div>
      ))}
    </>
  );
}
