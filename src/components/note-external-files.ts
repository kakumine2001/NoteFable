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
    const type = node.type.name;
    // 子がなくなった入れ子（blockGroup）と段（column）は残さない（空のままでは文書として不正）。
    if ((type === "blockGroup" || type === "column") && !inner.childCount) return;
    // 段組みは 2 段以上が必要。1 段だけ残ったら、段組みをやめて中のブロックをそのまま並べる。
    if (type === "columnList" && inner.childCount < 2) {
      inner.firstChild?.content.forEach((child) => { kept.push(child); });
      return;
    }
    kept.push(node.copy(inner));
  });
  return changed ? Fragment.fromArray(kept) : null;
}

// 端から開いたままにできる深さ（葉や isolating のノードの手前まで）。
function edgeDepth(fragment: Fragment, start: boolean) {
  let depth = 0;
  for (let node = start ? fragment.firstChild : fragment.lastChild; node && !node.isLeaf && !node.type.spec.isolating; node = start ? node.firstChild : node.lastChild) depth += 1;
  return depth;
}

// 変えるものがなければ元の slice をそのまま返す。開いた深さは元のまま（取り除いた後の端の深さまで）にする。
// 0 にすると、ProseMirror は 1 つの blockGroup を閉じたノードとして挿入し、貼ったブロックが今のブロックの子になる。
export function withoutExternalFiles(slice: Slice): Slice {
  const content = clean(slice.content);
  if (!content) return slice;
  if (!content.size) return Slice.empty;
  return new Slice(content, Math.min(slice.openStart, edgeDepth(content, true)), Math.min(slice.openEnd, edgeDepth(content, false)));
}

export const externalFilesGuard = createExtension({
  key: "notes-external-files",
  prosemirrorPlugins: [
    // transformPasted は貼り付けとドロップの両方（エディターの中でのブロックの移動も）に効く。
    new Plugin({ key: new PluginKey("notes-external-files"), props: { transformPasted: (slice) => withoutExternalFiles(slice) } }),
  ],
});
