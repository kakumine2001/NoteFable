// キャンバスのエディター（ホワイトボードなど）は、保存キュー（NoteSaveQueue）へまだ渡していない変更を持つことがある
// （描き終わりを待つ間・まとめて渡すまでの短い間・画像のアップロード中）。アプリが編集画面を閉じる前の flush など、
// キューを送り切る前に、開いているエディターから先に渡してもらう。

type CanvasFlusher = () => Promise<void> | void;

const flushers = new Set<CanvasFlusher>();

// エディターが開いている間だけ登録する。戻り値で登録を外す。
export function registerCanvasFlusher(flusher: CanvasFlusher): () => void {
  flushers.add(flusher);
  return () => { flushers.delete(flusher); };
}

// 開いているエディターの未提出の変更をキューへ渡す（画像のアップロードは各エディターが決めた時間まで待つ）。失敗しても投げない。
export async function flushCanvasEditors(): Promise<void> {
  await Promise.all([...flushers].map(async (flush) => {
    try { await flush(); } catch { /* 渡せなかった変更は、キューの flush の結果（未保存）として残る。 */ }
  }));
}
