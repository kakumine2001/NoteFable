// キャンバスのエディター（ホワイトボードなど）は、保存キュー（NoteSaveQueue）へまだ渡していない変更を持つことがある
// （描き終わりを待つ間・まとめて渡すまでの短い間・画像のアップロード中）。アプリが編集画面を閉じる前の flush や版の履歴など、
// キューを送り切る前に、開いているエディターから先に渡してもらう。

// 渡し切れたら true。待っても終わらないもの（アップロード中の画像など）が残ったら false。
type CanvasFlusher = () => Promise<boolean> | boolean;

const flushers = new Set<CanvasFlusher>();

// エディターが開いている間だけ登録する。戻り値で登録を外す。
export function registerCanvasFlusher(flusher: CanvasFlusher): () => void {
  flushers.add(flusher);
  return () => { flushers.delete(flusher); };
}

// 開いているエディターの未提出の変更をキューへ渡す（画像のアップロードは各エディターが決めた時間まで待つ）。
// すべて渡し切れたら true。投げたエディターは渡し切れなかったものとして数える。
export async function flushCanvasEditors(): Promise<boolean> {
  const results = await Promise.all([...flushers].map(async (flush) => {
    try { return await flush(); } catch { return false; }
  }));
  return results.every(Boolean);
}
