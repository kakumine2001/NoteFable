import { AsyncLocalStorage } from "node:async_hooks";
import { DOMParser } from "linkedom";
import { estimateLineWidth } from "@/lib/whiteboard/text-measure";

// サーバーで Mermaid を白板の要素に変換するときだけ使う、最小限のブラウザーの代わり（diagram.ts）。
// @excalidraw/mermaid-to-excalidraw は SVG を DOMParser で読み、文字を canvas で測り、文字参照を textarea で戻す。
// @excalidraw/element は window を（無ければ undefined として）参照する。
// これらをプロセス全体の本物のグローバルにすると、ほかの要求（React の描画など）が「ブラウザーにいる」と誤解するので、
// globalThis には「変換中の非同期の流れの中でだけ値を返す」読み取り専用の口を置く。それ以外の場所からは今までどおり undefined に見える
// （typeof document === "undefined" のまま）。同時に来たほかの要求には、変換中でも見えない（AsyncLocalStorage）。

type Scope = { document: FakeDocument; DOMParser: typeof DOMParser; window: undefined };

// 口（globalThis の getter）は一度置いたら置き換えないので、読む先の AsyncLocalStorage もプロセスで 1 つにする。
// このモジュールが 2 回読み込まれても（ルートごとのバンドル・開発時の再読み込み）、どちらの withServerDom も同じ口に値を渡せる。
const SHARED = Symbol.for("notefable.whiteboard.server-dom");
function sharedScope(): AsyncLocalStorage<Scope> {
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<Scope> | undefined>;
  return (holder[SHARED] ??= new AsyncLocalStorage<Scope>());
}

// Mermaid の #semi; / #num; は、変換器が &semi; / &num; にしてから戻させる。
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", semi: ";", num: "#" };

function decodeHtml(html: string) {
  return html
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, hex: string) => safeCodePoint(parseInt(hex, 16)) ?? match)
    .replace(/&#(\d{1,7});/g, (match, decimal: string) => safeCodePoint(Number(decimal)) ?? match)
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : null;
}

// canvas の 2D の文字計測の代わり。字体は見ず、文字の大きさと種類（text-measure.ts）から幅を見積もる。
function measureContext() {
  return {
    font: "20px sans-serif",
    fillStyle: "#000000",
    measureText(text: string) {
      const size = Number.parseFloat(this.font) || 20;
      return { width: estimateLineWidth(String(text), size), actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
    },
  };
}

type FakeDocument = { createElement(tag: string): unknown };

function fakeDocument(): FakeDocument {
  return {
    createElement(tag: string) {
      const name = tag.toLowerCase();
      if (name === "canvas") return { getContext: (type: string) => (type === "2d" ? measureContext() : null) };
      if (name === "textarea") {
        let value = "";
        return {
          set innerHTML(html: string) { value = decodeHtml(String(html)); },
          get innerHTML() { return value; },
          get value() { return value; },
        };
      }
      // CSS の色の確かめ（cssUtils）。空でない値をそのまま受け取る（色はあとで Excalidraw の既定に寄せる）。
      return { style: {} };
    },
  };
}

const NAMES = ["document", "window", "DOMParser"] as const;

function install() {
  const scope = sharedScope();
  for (const name of NAMES) {
    // テストの jsdom など、本物がすでにある（か、口を置き済みの）ときはそのまま使う（上書きしない）。
    if (Object.prototype.hasOwnProperty.call(globalThis, name)) continue;
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, get: () => scope.getStore()?.[name] });
  }
}

// fn の中（と、そこから続く非同期の処理）でだけ document / DOMParser が見える。
export function withServerDom<T>(fn: () => T): T {
  install();
  return sharedScope().run({ document: fakeDocument(), DOMParser, window: undefined }, fn);
}
