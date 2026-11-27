// キャンバスのエディター（ホワイトボードなど）は、保存キュー（NoteSaveQueue）へまだ渡していない変更を持つことがある
// （描き終わりを待つ間・まとめて渡すまでの短い間・画像のアップロード中）。アプリが編集画面を閉じる前の flush や版の履歴など、
// キューを送り切る前に、開いているエディターから先に渡してもらう。

// 渡し切れたら true。待っても終わらないもの（アップロード中の画像など）が残ったら false。
type CanvasFlusher = () => Promise<boolean> | boolean;
// 同期で未提出の編集をキューへ渡す。アップロード中の画像などまだ完了していない作業が残っていれば true。
type CanvasSyncFlusher = () => boolean;

const flushers = new Map<CanvasFlusher, string | undefined>();
// 同期のほうはページごとに持つ（ページを切り替えた直後、まだ外れていない前のページのエディターの作業を、新しいページのものと数えない）。
const syncFlushers = new Map<CanvasSyncFlusher, string | undefined>();

// エディターが開いている間だけ登録する。戻り値で登録を外す。pageId はページ単位で絞るときに使う。
export function registerCanvasFlusher(flusher: CanvasFlusher, syncFlush?: CanvasSyncFlusher, pageId?: string): () => void {
  flushers.set(flusher, pageId);
  if (syncFlush) syncFlushers.set(syncFlush, pageId);
  return () => {
    flushers.delete(flusher);
    if (syncFlush) syncFlushers.delete(syncFlush);
  };
}

// 開いているエディターの未提出の編集（400ms 待ちなど）を同期でキューへ渡す。
// 画像アップロード中など同期では渡し切れない作業が残っていれば true を返す。pageId を渡すとそのページのエディターだけを見る。
// exactOnly を true にすると、その pageId に紐付く作業だけを見る（別ページ表示中のバックグラウンドアップロード判定用）。
export function flushCanvasEditorsSync(pageId?: string, exactOnly = false): boolean {
  let pending = false;
  for (const [flush, owner] of syncFlushers) {
    if (pageId !== undefined && (exactOnly ? owner !== pageId : owner !== undefined && owner !== pageId)) continue;
    try { if (flush()) pending = true; } catch { pending = true; }
  }
  return pending;
}

// 開いているエディターの未提出の変更をキューへ渡す（画像のアップロードは各エディターが決めた時間まで待つ）。
// pageIds を渡すと、対象ページ（および所有者未指定の flusher）だけを待ち、別ページの遅いアップロードで無関係な操作を止めない。
// すべて渡し切れたら true。投げたエディターは渡し切れなかったものとして数える。
export async function flushCanvasEditors(pageIds?: string | ReadonlySet<string> | readonly string[]): Promise<boolean> {
  const targets = pageIds === undefined
    ? null
    : typeof pageIds === "string"
      ? new Set([pageIds])
      : new Set(pageIds);
  const matching: CanvasFlusher[] = [];
  for (const [flush, owner] of flushers) {
    if (targets !== null && owner !== undefined && !targets.has(owner)) continue;
    matching.push(flush);
  }
  const results = await Promise.all(matching.map(async (flush) => {
    try { return await flush(); } catch { return false; }
  }));
  return results.every(Boolean);
}
