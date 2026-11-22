// システムの「共有」から届いた内容（Web Share Target）を、チャットの入力欄へ渡すための部品。
// public/sw.js が POST /share-target で受け取った中身を Cache Storage に預け、/app?share=<id> へ 303 で送る。
// ここはそれを 1 度だけ取り出す側。Android・iOS の同名の規則（composeSharedText / ShareIntake）と同じ文の組み立てにする。

export const SHARE_CACHE_NAME = "notefable-share-v1";
export const SHARE_CACHE_PREFIX = "/__notefable_share__/";
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type ShareMeta = {
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: Array<{ index: number; name: string; type: string; size: number; truncated: boolean }>;
};

export type ConsumedWebShare = { text: string; files: File[] };

// タイトル・本文・URL を 1 つの文にまとめる。同じ内容が重なるもの（本文にすでに URL が入っている等）は 1 度だけ。
export function composeSharedText({ title, text, url }: { title?: string | null; text?: string | null; url?: string | null }) {
  const cleanTitle = (title ?? "").trim();
  const cleanText = (text ?? "").trim();
  const cleanUrl = (url ?? "").trim();
  const parts: string[] = [];
  if (cleanTitle && !cleanText.includes(cleanTitle) && cleanTitle !== cleanUrl) parts.push(cleanTitle);
  if (cleanText) parts.push(cleanText);
  if (cleanUrl && !cleanText.includes(cleanUrl)) parts.push(cleanUrl);
  return parts.join("\n");
}

// 入力欄にすでに書きかけがあれば消さずに、その後ろへ足す。
export function mergeDraftWithShare(existingDraft: string, sharedText: string) {
  if (!sharedText.trim()) return existingDraft;
  if (!existingDraft.trim()) return sharedText;
  return `${existingDraft}\n\n${sharedText}`;
}

// 開発時の StrictMode は effect を 2 回走らせる。1 度目で預かり物を消しても 2 度目が同じ結果を受け取れるよう、id ごとに 1 つの Promise を共有する。
const consumed = new Map<string, Promise<ConsumedWebShare | null>>();

export function consumeWebShare(id: string): Promise<ConsumedWebShare | null> {
  if (!SHARE_ID_PATTERN.test(id)) return Promise.resolve(null);
  const existing = consumed.get(id);
  if (existing) return existing;
  const next = readAndDelete(id).catch(() => null);
  consumed.set(id, next);
  return next;
}

async function readAndDelete(id: string): Promise<ConsumedWebShare | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE_NAME);
  const base = `${SHARE_CACHE_PREFIX}${id}`;
  const metaResponse = await cache.match(`${base}/meta.json`);
  if (!metaResponse) return null;
  const meta = (await metaResponse.json()) as ShareMeta;
  const files: File[] = [];
  for (const info of meta.files ?? []) {
    const response = await cache.match(`${base}/file-${info.index}`);
    const blob = response ? await response.blob() : new Blob([]);
    const file = new File([blob], info.name, { type: info.type });
    // 大きすぎて預けなかったファイルも、本当の大きさを名乗らせる。そうすると添付の検証が「20 MiB を超えています」と正しく断る。
    if (info.truncated) Object.defineProperty(file, "size", { value: info.size });
    files.push(file);
  }
  await cache.delete(`${base}/meta.json`);
  for (const info of meta.files ?? []) await cache.delete(`${base}/file-${info.index}`);
  return { text: composeSharedText(meta), files };
}
