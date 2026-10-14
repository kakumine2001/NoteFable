import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

// 画面の切り替えにかける動き。fade は同じ場所で入れ替わる（Chat ⇄ Note）、forward / back は横にすべる
// （スマホで一覧からノートを開く / 一覧へ戻る）、list は一覧の行だけが動く（追加・削除・移動）。
export type TransitionKind = "fade" | "forward" | "back" | "list";

type NativeTransition = { ready: Promise<void>; finished: Promise<void>; skipTransition?: () => void };
type DocumentWithTransitions = Document & { startViewTransition?: (callback: () => void) => NativeTransition };

// 一覧の行に付ける名前。行に className="vt-row" と一緒に付けると、追加・削除・移動のときに行が滑らかに動く。
// 同じ名前が同時に 2 つ画面にあると切り替えが取り消されるので、場所ごとに接頭辞を変える。
export const rowName = (name: string) => ({ "--vt-name": name }) as CSSProperties;
let latestTransition = 0;
let navigationGeneration = 0;
let currentDocument: DocumentWithTransitions | undefined;
let active: NativeTransition | null = null;
type Job = { doc: DocumentWithTransitions; update: () => void; kind: TransitionKind; generation: number };
let pending: Job[] = [];

const valid = (job: Job) => job.kind === "list" || job.generation === navigationGeneration;

function next() {
  if (active) return;
  const job = pending.shift();
  if (!job) return;
  if (!valid(job)) { next(); return; }
  const root = job.doc.documentElement;
  const token = ++latestTransition;
  root.dataset.vtKind = job.kind;
  let applied = false;
  const apply = () => {
    if (applied || !valid(job)) return;
    applied = true;
    flushSync(job.update);
  };
  const clear = () => {
    if (latestTransition !== token) return;
    delete root.dataset.vtKind;
    active = null;
    next();
  };
  try {
    active = job.doc.startViewTransition!(apply);
    active.ready.catch(() => {});
    active.finished.then(clear, clear);
  } catch {
    apply();
    clear();
  }
}

// ブラウザの View Transition で、状態の切り替えをなめらかに見せる。
// 対応していない・「視覚効果を減らす」設定のときは、動きなしでそのまま切り替える。
// update の中で React の状態を変えると、flushSync で同期的に描画してから新しい見た目を撮る。
export function runTransition(update: () => void, kind: TransitionKind = "fade", animate = true) {
  const doc = typeof document === "undefined" ? undefined : (document as DocumentWithTransitions);
  if (currentDocument !== doc) {
    currentDocument = doc;
    ++latestTransition;
    pending = [];
    active = null;
  }
  // ナビゲーションは最新だけ有効。一覧のデータ更新は古くても捨てず、受け取った順に実行する。
  const generation = kind === "list" ? navigationGeneration : ++navigationGeneration;
  if (!animate || !doc?.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    active?.skipTransition?.();
    update();
    return;
  }
  pending.push({ doc, update, kind, generation });
  // 二重 startViewTransition を避け、前の描画が終わってから次へ。連打では古い見た目のアニメーションを飛ばす。
  active?.skipTransition?.();
  next();
}
