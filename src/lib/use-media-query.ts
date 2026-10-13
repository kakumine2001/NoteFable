import { useSyncExternalStore } from "react";

// CSS のメディアクエリが一致しているか。サーバー側と初回描画は false にして、ハイドレーションの不一致を避ける。
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
