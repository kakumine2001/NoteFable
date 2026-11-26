import { useEffect, useRef } from "react";

// close が false を返したら「いまは閉じない」（シートは開いたまま）。
type Sheet = { close: () => boolean | void; closedByBack: boolean };

// 開いているシートを開いた順に持つ。重なっているときは一番上のシートだけを閉じる。
const openSheets: Sheet[] = [];
// シートが 1 枚でも開いている間、履歴の一番上に積んでおく目印（枚数に関わらず 1 件）。
const MARKER = { notefableSheet: true };
// 最後のシートが閉じたあとの history.back() の予約。すぐ別のシートが開くなら取り消して目印を使い回す。
let pendingBack: ReturnType<typeof setTimeout> | null = null;
// 自分で呼んだ history.back() が起こす popstate を、端末の「戻る」と区別して無視するための印。
let ownBack = false;
let ownBackEvent: Event | null = null;
let listening = false;

const hasMarker = () => !!window.history.state?.notefableSheet;

// いま届いた popstate がシート・ドロワーの後始末（history.back）によるものか。
// リスナーの登録順に関わらず判定できるよう、処理中（ownBack）と同一イベント配送中（ownBackEvent）の両方を見る。
export function isSheetCleanupPopState(event?: Event): boolean {
  if (event && !event.isTrusted) return false;
  return ownBack || (Boolean(event) && ownBackEvent === event);
}

// 目印を外す history.back() を待っている処理（afterSheetHistory）。
const afterBack: (() => void)[] = [];
// popstate 後に setTimeout で flushAfterBack を待っている間のタイマー。
// ownBack が false に戻った直後〜flushAfterBack 実行前の呼び出しが、先に並んだ URL 書き換えを追い越さないように保つ。
let pendingFlush: ReturnType<typeof setTimeout> | null = null;
function flushAfterBack() {
  pendingFlush = null;
  try {
    while (afterBack.length > 0 && pendingBack === null && !ownBack) {
      const callback = afterBack.shift()!;
      callback();
    }
  } finally {
    if (afterBack.length > 0 && pendingBack === null && !ownBack && pendingFlush === null) {
      pendingFlush = setTimeout(flushAfterBack);
    }
  }
}

// シートを閉じたあとに今の履歴（URL）を書き換えたいとき用。閉じたシートの目印を外す history.back() が予約中・進行中、
// または戻り後の実行待ちの間は後ろに並べ、終わってから登録順に呼ぶ。なければすぐ呼ぶ。
export function afterSheetHistory(callback: () => void) {
  if (pendingBack === null && !ownBack && pendingFlush === null && afterBack.length === 0) {
    callback();
    return;
  }
  afterBack.push(callback);
}

function onPopState(event: PopStateEvent) {
  // 履歴を置き換えたあとにアプリが自分で投げる合成イベントは「戻る」ではない。
  if (!event.isTrusted) return;
  if (ownBack) {
    ownBack = false;
    ownBackEvent = event;
    queueMicrotask(() => { if (ownBackEvent === event) ownBackEvent = null; });
    // 退けた目印のあとに別のシートが開いていた（目印を積み損ねた）場合は積み直す。
    restoreSheetMarker();
    // 元の履歴に戻った。Next.js がこの popstate を処理し終えてから、待っていた書き換えをする。
    if (pendingFlush === null) pendingFlush = setTimeout(flushAfterBack);
    return;
  }
  // 端末の「戻る」: 目印が外れたので、一番上のシートを閉じる。
  const top = openSheets.pop();
  if (!top) return;
  top.closedByBack = true;
  if (top.close() === false) {
    // 閉じるのを断られた（保存中など）。シートは開いたままなので、登録と目印を元に戻す。
    top.closedByBack = false;
    openSheets.push(top);
    window.history.pushState(MARKER, "");
    return;
  }
  // 下にまだシートがあれば、次の「戻る」でそれを閉じられるよう目印を積み直す。
  // 最後のシートが「戻る」で閉じたなら目印は外れたので、待っていた履歴書き換えを実行する。
  if (openSheets.length > 0) window.history.pushState(MARKER, "");
  else if (afterBack.length > 0 && pendingFlush === null) pendingFlush = setTimeout(flushAfterBack);
}

// シートが開いているときの Esc は一番上の 1 枚だけを閉じる。capture で受けて止めるので、同じ Esc でポップオーバーなどが重ねて閉じない。
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing) return;
  const top = openSheets[openSheets.length - 1];
  if (!top) return;
  event.stopPropagation();
  // 既定の動作も止める。<dialog> は Esc を「閉じる要求」（cancel）にもするので、止めないと close が 2 回呼ばれる。
  event.preventDefault();
  top.close();
}

// 画面遷移（履歴の置き換え）で目印が消えたのに、シートがまだ開いているときに積み直す。
// シートが閉じる処理は遷移より後に走るので、1 拍置いて「本当にまだ開いているもの」だけを見る。
export function restoreSheetMarker() {
  setTimeout(() => {
    if (openSheets.length > 0 && !hasMarker()) window.history.pushState(MARKER, "");
  });
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKeyDown, true);
}

// シート（下から出るパネル）を開いている間は履歴を 1 件積み、端末の「戻る」でアプリを閉じずにシートだけ閉じる。
// 画面のボタンや Esc で閉じた場合は、自分が積んだ履歴だけを取り除く（別の画面遷移が積んだ履歴は触らない）。
// シートが重なっていても履歴は 1 件だけで、「戻る」と Esc は一番上の 1 枚だけを閉じる。
// onClose が false を返すと閉じなかった扱いになり、「戻る」のあとも登録と履歴の目印を保つ（保存中のダイアログなど）。
export function useBackToClose(open: boolean, onClose: () => boolean | void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const sheet: Sheet = { close: () => onCloseRef.current(), closedByBack: false };
    openSheets.push(sheet);
    listen();
    if (pendingBack !== null) {
      // 閉じた直後に別のシートが開いた（行を切り替えた、開発時の再実行など）。
      // 目印はまだ履歴の上に残るので、afterBack はこのシートが閉じて目印が外れるまで保留する。
      clearTimeout(pendingBack);
      pendingBack = null;
    }
    // 目印が残っていればそれを使い回し、無ければ（その間に「戻る」で外れた場合など）積む。
    if (!hasMarker()) window.history.pushState(MARKER, "");

    return () => {
      const index = openSheets.indexOf(sheet);
      if (index >= 0) openSheets.splice(index, 1);
      // 「戻る」で閉じたなら目印はもう外れている。ほかのシートが残っているうちは目印も残す。
      if (sheet.closedByBack || openSheets.length > 0) return;
      pendingBack = setTimeout(() => {
        pendingBack = null;
        // 画面遷移が目印を置き換えていたら何もしない。
        if (openSheets.length === 0 && hasMarker()) {
          ownBack = true;
          window.history.back();
          // popstate が来なかったときに次の本物の「戻る」を飲み込まないよう、一定時間後に解除する。
          setTimeout(() => {
            if (!ownBack) return;
            ownBack = false;
            flushAfterBack();
          }, 1000);
        } else {
          flushAfterBack();
        }
      });
    };
  }, [open]);
}
