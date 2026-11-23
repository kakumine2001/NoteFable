import { StorageLimitError, storageLimitErrorFrom } from "@/lib/usage-plans";

// ノートの画像・ファイル・カバー・アイコンのアップロードが容量の上限で断られたことを、ノートの画面（NotesWorkspace）へ知らせる。
// アップロードする部品は深いところにあるので、window のイベントで伝える。画面は理由と、ログイン・アップグレードの案内を出す
// （アプリに埋め込んだ編集画面では、アプリが自分の画面で出す。src/lib/native-bridge.ts の storageLimit）。
export const STORAGE_LIMIT_EVENT = "notefable:storage-limit";
export type StorageLimitDetail = Pick<StorageLimitError, "tier" | "used" | "limit">;

export function announceStorageLimit(error: StorageLimitError) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StorageLimitDetail>(STORAGE_LIMIT_EVENT, { detail: { tier: error.tier, used: error.used, limit: error.limit } }));
}

// アップロードの応答が容量の上限なら、画面に知らせてその例外を返す（呼び出し側が投げる）。それ以外は null。
export function storageLimitFromUpload(status: number, data: unknown) {
  const error = storageLimitErrorFrom(status, data);
  if (error) announceStorageLimit(error);
  return error;
}
