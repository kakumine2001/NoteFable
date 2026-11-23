// 検索結果から開いたノートのブロック・会話のメッセージまで移動し、少しの間だけ目立たせる（クライアント専用）。
// 要素がまだ描画されていない場合（ノートや会話を開いた直後）は、現れるまで最大 4 秒待つ。

// 強調用のクラス。見た目は search-dialog.css にある。
export const REVEAL_CLASS = "search-reveal-flash";
const WAIT_MS = 4000;
const FLASH_MS = 2000;

export type RevealOptions = {
  // 別のノートや会話へ移った、などで待つのをやめたいときに abort する。結果は false。
  signal?: AbortSignal;
};

// 属性セレクターの引用符の中に入れる値。ID は英数字だけだが、念のため " と \ を退避する。
function attributeValue(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

// BlockNote は各ブロックを <div class="bn-block-outer" data-id="…"> で包む（子ブロックもこの中に入る）。
// 履歴のプレビューなどで同じ ID が重なっても、本編のエディターを先に探すよう .notes-block-editor の中に限る。
export const noteBlockSelector = (blockId: string) => `.notes-block-editor .bn-block-outer[data-id="${attributeValue(blockId)}"]`;
export const chatMessageSelector = (messageId: string) => `[data-message-id="${attributeValue(messageId)}"]`;

let active: { element: Element; timer: ReturnType<typeof setTimeout> } | null = null;

function clearFlash() {
  if (!active) return;
  clearTimeout(active.timer);
  active.element.classList.remove(REVEAL_CLASS);
  active = null;
}

function flash(element: HTMLElement) {
  clearFlash();
  // 同じ要素を続けて強調するときにアニメーションを最初からやり直せるよう、一度クラスを外して再計算させる。
  void element.offsetWidth;
  element.classList.add(REVEAL_CLASS);
  active = { element, timer: setTimeout(clearFlash, FLASH_MS) };
}

function reveal(find: () => HTMLElement | null, flashTarget: (element: HTMLElement) => HTMLElement, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    let settled = false;
    let found = false;
    let frame = 0;
    // 要素が現れる（または data-id が付く）のを待つ。見つかるか、時間切れか、中止された時点で必ず片付ける。
    const observer = new MutationObserver(() => check());
    const timeout = setTimeout(() => finish(false), WAIT_MS);

    const finish = (result: boolean) => {
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => finish(false);

    function check() {
      if (settled || found) return;
      const element = find();
      if (!element) return;
      found = true;
      observer.disconnect();
      clearTimeout(timeout);
      // 同じ描画で動く自動スクロール（会話を末尾へ送る処理など）が落ち着くのを 2 フレーム待ってから動かす。
      // その間に React が要素を作り直していても追えるよう、動かす直前にもう一度探す。
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const target = find() ?? element;
          const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
          flash(flashTarget(target));
          finish(true);
        });
      });
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-id", "data-message-id"] });
    check();
  });
}

// ノートのブロックを画面の中央へ動かして強調する。見つかったら true、時間内に現れなければ false。
// 折りたたまれたトグル（折りたたみリスト・折りたたみ見出し）の中にあるブロックは display: none で見えない。
// 外側のトグルを内から外へ順に開く（開閉は BlockNote のボタンに任せ、開いた状態もそちらが覚える）。
function expandCollapsedAncestors(element: HTMLElement) {
  for (let outer = element.parentElement?.closest<HTMLElement>(".bn-block-outer"); outer; outer = outer.parentElement?.closest<HTMLElement>(".bn-block-outer")) {
    const wrapper = [...outer.querySelectorAll<HTMLElement>('.bn-toggle-wrapper[data-show-children="false"]')]
      .find((candidate) => candidate.closest(".bn-block-outer") === outer);
    wrapper?.querySelector<HTMLElement>(".bn-toggle-button")?.click();
  }
}

// スライドでは一致した ID が枚の ID なので、エディターにその枚を開いてもらい（notefable:reveal-canvas-item）、縮小図を強調する。
export const canvasItemSelector = (itemId: string) => `.slides-editor [data-slide-id="${attributeValue(itemId)}"]`;
export function revealNoteBlock(blockId: string, options: RevealOptions = {}) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent<string>("notefable:reveal-canvas-item", { detail: blockId }));
  return reveal(
    () => {
      const element = document.querySelector<HTMLElement>(noteBlockSelector(blockId)) ?? document.querySelector<HTMLElement>(canvasItemSelector(blockId));
      if (element) expandCollapsedAncestors(element);
      return element;
    },
    // 子ブロックまで光らないよう、そのブロック自身の本文だけを強調する。
    (outer) => outer.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content") ?? outer,
    options.signal,
  );
}

// 会話のメッセージ（<article data-message-id>）を画面の中央へ動かして強調する。
export function revealChatMessage(messageId: string, options: RevealOptions = {}) {
  return reveal(() => document.querySelector<HTMLElement>(chatMessageSelector(messageId)), (element) => element, options.signal);
}
