"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/native-app";

// インストール済みの外壳はルート URL で起動する。紹介ページを履歴に残さず、従来どおりチャットを開く。
export function LandingNativeRedirect() {
  useEffect(() => {
    if (isNativeApp()) {
      window.location.replace(`/app${window.location.search}${window.location.hash}`);
    }
  }, []);

  return null;
}
