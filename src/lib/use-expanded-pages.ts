"use client";

import { useCallback, useSyncExternalStore } from "react";

// サイドバーとスマホのホームで、開いているサブページの木（ページ ID → true）。端末に覚えておき、
// 同時に表示されている両方の画面（スマホの抽屉とホーム）が同じ値を見るよう、1 つの小さな store にまとめる。
const EXPANDED_KEY = "notefable:note-pages-expanded:v1";
const EMPTY: Record<string, boolean> = {};

let current: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function read(): Record<string, boolean> {
  if (current) return current;
  try { current = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "{}") as Record<string, boolean>; } catch { current = {}; }
  return current;
}

function write(next: Record<string, boolean>) {
  current = next;
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は変えない。 */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useExpandedPages() {
  // サーバー描画では空（Notes に切り替えた後にだけ使われるので、表示はずれない）。
  const expanded = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: string, open: boolean) => {
    const next = { ...read() };
    if (open) next[id] = true; else delete next[id];
    write(next);
  }, []);
  const expand = useCallback((id: string) => { if (!read()[id]) toggle(id, true); }, [toggle]);
  return [expanded, toggle, expand] as const;
}
