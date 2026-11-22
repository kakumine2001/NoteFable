// デスクトップ幅でチャットとノートを左右に並べる分割表示の保存と比率計算。
export const SPLIT_VIEW_MEDIA_QUERY = "(min-width: 1100px)";
export const SPLIT_STORAGE_KEY = "notefable:split-view:v1";
export const DEFAULT_SPLIT_RATIO = 0.46;
export const MIN_SPLIT_RATIO = 0.3;
export const MAX_SPLIT_RATIO = 0.65;

export type SplitViewPreference = {
  open: boolean;
  pageId: string | null;
  ratio: number;
};

export function clampSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Math.round(value * 1000) / 1000));
}

export function loadSplitPreference(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): SplitViewPreference {
  const fallback: SplitViewPreference = { open: false, pageId: null, ratio: DEFAULT_SPLIT_RATIO };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(SPLIT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SplitViewPreference> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      open: parsed.open === true,
      pageId: typeof parsed.pageId === "string" && parsed.pageId.trim() ? parsed.pageId : null,
      ratio: clampSplitRatio(parsed.ratio),
    };
  } catch {
    return fallback;
  }
}

export function saveSplitPreference(
  pref: SplitViewPreference,
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
) {
  if (!storage) return;
  try {
    storage.setItem(
      SPLIT_STORAGE_KEY,
      JSON.stringify({ open: pref.open, pageId: pref.pageId, ratio: clampSplitRatio(pref.ratio) }),
    );
  } catch {
    // ストレージが使えない環境でも操作自体は止めない。
  }
}
