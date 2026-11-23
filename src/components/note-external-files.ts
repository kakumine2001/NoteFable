// ノートの画像・ファイルのブロックは、自分のサービスにアップロードしたファイル（/api/pages/files?key=…）しか持てない
// （validateNoteContent）。ほかのページから画像をドラッグ・ドロップすると、外部の URL を持つ画像ブロックができて
// ノートが保存できなくなるので、貼り付け・ドロップされる内容からそういうブロックを取り除く。
// 自分のファイルの画像（ブロックのドラッグでの移動、ノート間のコピー）と、アップロード待ちの空のブロックはそのまま通す。
// HTML の画像を含む貼り付けは、エディターの pasteHandler が先に文字だけにする。
import { createExtension } from "@blocknote/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { parseNoteFileUrl } from "@/lib/note-file-keys";

const FILE_BLOCKS = new Set(["image", "file"]);

function isExternalFile(node: PMNode) {
  const url: unknown = node.attrs.url;
  return FILE_BLOCKS.has(node.type.name) && typeof url === "string" && url !== "" && parseNoteFileUrl(url) === null;
}

// ブロックの入れ物（blockContainer）は、中身が外部のファイルなら子ブロックごと外す。
function dropped(node: PMNode) {
  return isExternalFile(node) || (node.type.name === "blockContainer" && !!node.firstChild && isExternalFile(node.firstChild));
}

function clean(fragment: Fragment): Fragment | null {
  let changed = false;
  const kept: PMNode[] = [];
  fragment.forEach((node) => {
    if (dropped(node)) { changed = true; return; }
    const inner = node.isLeaf ? null : clean(node.content);
    if (!inner) { kept.push(node); return; }
    changed = true;
    // 子がなくなった入れ子（blockGroup）は残さない（空の blockGroup は文書として不正）。
    if (node.type.name === "blockGroup" && !inner.childCount) return;
    kept.push(node.copy(inner));
  });
  return changed ? Fragment.fromArray(kept) : null;
}

// 変えるものがなければ元の slice をそのまま返す。
export function withoutExternalFiles(slice: Slice): Slice {
  const content = clean(slice.content);
  if (!content) return slice;
  return content.size ? new Slice(content, 0, 0) : Slice.empty;
}

export const externalFilesGuard = createExtension({
  key: "notes-external-files",
  prosemirrorPlugins: [
    // transformPasted は貼り付けとドロップの両方（エディターの中でのブロックの移動も）に効く。
    new Plugin({ key: new PluginKey("notes-external-files"), props: { transformPasted: (slice) => withoutExternalFiles(slice) } }),
  ],
});
