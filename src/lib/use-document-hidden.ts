"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function read() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

// タブやウィンドウが非表示のあいだ true を返す（無限アニメーションを止めて電池と CPU を節約するため）。
export function useDocumentHidden() {
  return useSyncExternalStore(subscribe, read, () => false);
}
