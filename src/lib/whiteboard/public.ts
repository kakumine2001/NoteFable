import { noteFileUrlName, parseNoteFileUrl } from "@/lib/note-file-keys";
import { shareFileUrl } from "@/lib/note-share";
import {
  effectivePageCardOf,
  pageCardLabel,
  pageCardOf,
  pageLinkUrl,
  wrapCardLabelText,
  type PageCardPreview,
} from "@/lib/whiteboard/links";
import { storedToScene, type StoredWhiteboard, type WhiteboardElement } from "@/lib/whiteboard/scene";

// 公開リンク（/s/:token）でホワイトボードを見せるときの形。サーバーとテストから使う（Excalidraw の本体は読み込まない）。
// 画像の URL は持ち主だけが読める /api/pages/files ではなく、公開ページ用の /s/:token/file に置き換える。
// /s/:token/file は、そのホワイトボードの files が実際に参照しているファイルだけを返す（whiteboardFileKeys）。

export type PublicWhiteboardSceneOptions = {
  // 同じ公開ツリー内のページカードだけを入れた辞書。渡されたとき、ツリー内のカードは最新の題名とアイコンに差し替え、
  // ツリー外（非公開・除外・削除済み）のカードは題名・リンク・参照 ID を落として漏らさない。
  cards?: Readonly<Record<string, PageCardPreview>>;
  untitled?: string;
  unavailableLabel?: string;
};

// 生きている画像要素が使う note-files の保存先（キー）。見る画面に渡す scene（storedToScene）と同じものだけ：
// 消した画像・どの要素も使っていないファイル・同じファイルの 2 つ目の URL は読ませない。
export function whiteboardFileKeys(data: unknown): Set<string> {
  const keys = new Set<string>();
  for (const file of Object.values(storedToScene(data).files)) {
    const parsed = parseNoteFileUrl(file.dataURL);
    if (parsed && parsed !== "empty") keys.add(parsed.path);
  }
  return keys;
}

// 公開する要素の customData は、有効なページカードの印（notefablePage）だけを残す（ほかのアプリの拡張の値を外に出さない）。
function publicElement(element: WhiteboardElement): WhiteboardElement {
  if (element.customData === undefined) return element;
  const { customData, ...rest } = element;
  void customData;
  const card = effectivePageCardOf(element);
  return card ? { ...rest, customData: { notefablePage: card } } : rest;
}

function measureWrappedText(label: string, containerWidth: number, fontSize: number, lineHeight: number) {
  const text = wrapCardLabelText(label, containerWidth, fontSize);
  const lines = text.split("\n").length;
  const height = Math.ceil(lines * fontSize * lineHeight);
  return { text, height };
}

function replaceElementText(
  element: WhiteboardElement,
  label: string,
  container: { width: number; height: number; y?: number },
): WhiteboardElement {
  const fontSize = typeof element.fontSize === "number" && element.fontSize > 0 ? element.fontSize : 18;
  const lineHeight = typeof element.lineHeight === "number" && element.lineHeight > 0 ? element.lineHeight : 1.25;
  const { text, height } = measureWrappedText(label, container.width, fontSize, lineHeight);
  const nextY = typeof container.y === "number"
    ? container.y + (Math.max(container.height, height + 24) - height) / 2
    : element.y;
  return {
    ...element,
    originalText: label,
    text,
    height,
    ...(typeof nextY === "number" ? { y: nextY } : {}),
  };
}

// 公開ページで描く scene。消した要素は入れない。画像は公開用の URL、外部へのリンクはそのまま（ページへのリンクは見る画面が公開リンクに読み替える）。
export function publicWhiteboardScene(
  data: unknown,
  token: string,
  pageId: string,
  options?: PublicWhiteboardSceneOptions,
): StoredWhiteboard {
  const scene = storedToScene(data);
  const files: StoredWhiteboard["files"] = {};
  for (const [id, file] of Object.entries(scene.files)) {
    const parsed = parseNoteFileUrl(file.dataURL);
    if (!parsed || parsed === "empty") continue;
    files[id] = { id, mimeType: file.mimeType, dataURL: shareFileUrl(token, pageId, parsed.path, noteFileUrlName(file.dataURL)) };
  }

  const cardMap = options?.cards;
  if (!cardMap) {
    return { elements: scene.elements.map(publicElement), files, appState: scene.appState };
  }

  const untitled = options.untitled ?? "Untitled";
  const unavailableLabel = options.unavailableLabel ?? "This page is not available";

  // ページカード本体（notefablePage を持つ要素）と、そこに結び付く文字要素を把握する。
  // リンクが削除・外部 URL へ変更された既存カードは link を尊重し、元のページリンクを復活させない。
  const cardStateByElementId = new Map<string, {
    label: string | null;
    inTree: PageCardPreview | null;
    preserveLink: boolean;
    width: number;
    height: number;
    y?: number;
  }>();
  const boundTextToCardId = new Map<string, string>();
  for (const element of scene.elements) {
    const rawCard = pageCardOf(element.customData);
    if (!rawCard) continue;
    const effective = effectivePageCardOf(element);
    const width = typeof element.width === "number" ? element.width : 280;
    const height = typeof element.height === "number" ? element.height : 70;
    const y = typeof element.y === "number" ? element.y : undefined;
    if (!effective) {
      // link が外された・外部 URL へ変えられたカード：notefablePage を落とし、link はそのまま残す。
      // リンクが外されたカードで元ページが共有ツリー外なら、残った文字から非公開タイトルが漏れないよう伏せる。
      const linkRemoved = element.link === null || (typeof element.link === "string" && !element.link.trim());
      const origInTree = Object.hasOwn(cardMap, rawCard.id);
      const label = linkRemoved && !origInTree ? unavailableLabel : null;
      cardStateByElementId.set(element.id, { label, inTree: null, preserveLink: true, width, height, y });
    } else {
      const inTree = Object.hasOwn(cardMap, effective.id) ? cardMap[effective.id] : null;
      const label = inTree ? pageCardLabel(inTree, untitled) : unavailableLabel;
      cardStateByElementId.set(element.id, { label, inTree, preserveLink: false, width, height, y });
    }
    if (Array.isArray(element.boundElements)) {
      for (const bound of element.boundElements) {
        if (bound && typeof bound === "object" && (bound as { type?: unknown }).type === "text" && typeof (bound as { id?: unknown }).id === "string") {
          boundTextToCardId.set((bound as { id: string }).id, element.id);
        }
      }
    }
  }

  // 複数行になった文字が収まるよう、必要なカード枠の高さも広げておく。
  for (const element of scene.elements) {
    if (element.type !== "text") continue;
    const parentCardId = (typeof element.containerId === "string" && cardStateByElementId.has(element.containerId))
      ? element.containerId
      : boundTextToCardId.get(element.id);
    if (!parentCardId) continue;
    const parent = cardStateByElementId.get(parentCardId)!;
    if (parent.label === null) continue;
    const fontSize = typeof element.fontSize === "number" && element.fontSize > 0 ? element.fontSize : 18;
    const lineHeight = typeof element.lineHeight === "number" && element.lineHeight > 0 ? element.lineHeight : 1.25;
    const { height } = measureWrappedText(parent.label, parent.width, fontSize, lineHeight);
    if (height + 24 > parent.height) parent.height = height + 24;
  }

  const elements = scene.elements.map((element) => {
    const ownCard = cardStateByElementId.get(element.id);
    if (ownCard) {
      const { customData: _customData, ...rest } = element;
      void _customData;
      const base: WhiteboardElement = ownCard.preserveLink
        ? { ...rest, height: ownCard.height }
        : ownCard.inTree
          ? {
              ...rest,
              height: ownCard.height,
              link: pageLinkUrl(ownCard.inTree.id),
              customData: { notefablePage: { id: ownCard.inTree.id, kind: ownCard.inTree.kind } },
            }
          : { ...rest, height: ownCard.height, link: null };
      if (ownCard.label !== null && (typeof base.text === "string" || typeof base.originalText === "string")) {
        return replaceElementText(base, ownCard.label, ownCard);
      }
      return base;
    }

    const sanitized = publicElement(element);
    if (sanitized.type === "text") {
      const parentCardId = (typeof sanitized.containerId === "string" && cardStateByElementId.has(sanitized.containerId))
        ? sanitized.containerId
        : boundTextToCardId.get(sanitized.id);
      if (parentCardId) {
        const parent = cardStateByElementId.get(parentCardId)!;
        if (parent.label !== null) return replaceElementText(sanitized, parent.label, parent);
      }
    }
    return sanitized;
  });

  return { elements, files, appState: scene.appState };
}
