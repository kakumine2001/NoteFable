import { noteFileUrlName, parseNoteFileUrl } from "@/lib/note-file-keys";

const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidShareToken(token: unknown): token is string {
  return typeof token === "string" && SHARE_TOKEN_RE.test(token);
}

// 公開ページのパス。親の公開トークンの下にあるサブページは /s/<token>/p/<pageId>。
export function sharePagePath(token: string, subpageId?: string | null) {
  const base = `/s/${encodeURIComponent(token)}`;
  return subpageId ? `${base}/p/${encodeURIComponent(subpageId)}` : base;
}

export function sharePageUrl(token: string, origin: string, subpageId?: string | null) {
  return `${origin.replace(/\/+$/, "")}${sharePagePath(token, subpageId)}`;
}

// 公開ページ内の画像・ファイル URL。
export function shareFileUrl(token: string, pageId: string, key: string, name: string) {
  const params = new URLSearchParams({ page: pageId, key });
  if (name) params.set("name", name);
  return `/s/${encodeURIComponent(token)}/file?${params.toString()}`;
}

export function shareCoverUrl(token: string, pageId: string) {
  return `/s/${encodeURIComponent(token)}/cover?page=${encodeURIComponent(pageId)}`;
}

export type ShareExpiryPreset = "never" | "1h" | "1d" | "7d" | "30d" | "custom";

const PRESET_MS: Record<Exclude<ShareExpiryPreset, "never" | "custom">, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function expiryFromPreset(preset: Exclude<ShareExpiryPreset, "custom">, now = Date.now()): string | null {
  if (preset === "never") return null;
  return new Date(now + PRESET_MS[preset]).toISOString();
}

export function isShareRowActive(
  row: { deletedAt?: Date | null; shareEnabled: boolean; shareToken: string | null; shareExpiresAt: Date | null },
  now = new Date(),
): boolean {
  if (row.deletedAt) return false;
  if (!row.shareEnabled || !row.shareToken) return false;
  if (row.shareExpiresAt && row.shareExpiresAt.getTime() <= now.getTime()) return false;
  return true;
}

type RawBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown[];
};

// ブロックツリーから、このページが参照している note-files のキー集合を取り出す。
export function extractBlockFileKeys(blocks: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const block = item as RawBlock;
      if ((block.type === "image" || block.type === "file") && block.props && typeof block.props.url === "string") {
        const parsed = parseNoteFileUrl(block.props.url);
        if (parsed && parsed !== "empty") keys.add(parsed.path);
      }
      if (Array.isArray(block.children)) walk(block.children);
    }
  };
  walk(blocks);
  return keys;
}

// 公開ページ描画用に、画像・ファイルブロックの URL を公開メディア経路へ書き換える。
export function rewriteBlocksForShare<T>(blocks: T, token: string, pageId: string): T {
  const walk = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list;
    return list.map((item) => {
      if (!item || typeof item !== "object") return item;
      const block = item as RawBlock;
      let nextProps = block.props;
      if ((block.type === "image" || block.type === "file") && block.props && typeof block.props.url === "string") {
        const parsed = parseNoteFileUrl(block.props.url);
        if (parsed && parsed !== "empty") {
          const name = noteFileUrlName(block.props.url) || (typeof block.props.name === "string" ? block.props.name : "");
          nextProps = { ...block.props, url: shareFileUrl(token, pageId, parsed.path, name) };
        }
      }
      const nextChildren = Array.isArray(block.children) ? walk(block.children) : block.children;
      if (nextProps === block.props && nextChildren === block.children) return block;
      return { ...block, ...(nextProps !== undefined ? { props: nextProps } : {}), ...(nextChildren !== undefined ? { children: nextChildren } : {}) };
    });
  };
  return walk(blocks) as T;
}
