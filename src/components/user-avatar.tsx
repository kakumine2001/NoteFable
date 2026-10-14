"use client";

import { useState } from "react";
import type { AccountUser } from "@/lib/user-profile";

// 利用者の顔。自分で選んだ絵文字があればそれ、なければ Google の写真、写真が出ないときは名前の頭文字。
export function UserAvatar({ user, size = 24 }: { user: Pick<AccountUser, "avatarUrl" | "icon" | "image" | "name">; size?: number }) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const markBroken = (url: string) => setBrokenImages((current) => new Set(current).add(url));
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };

  // 自分でアップロードした写真が一番優先。読み込めなければ、次の候補（絵文字・Google の写真・頭文字）に落とす。
  if (user.avatarUrl && !brokenImages.has(user.avatarUrl)) {
    return (
      <span className="user-avatar" style={style} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 所有者確認付き API が返す private 画像なので next/image の最適化は使わない */}
        <img src={user.avatarUrl} alt="" onError={() => markBroken(user.avatarUrl!)} />
      </span>
    );
  }
  if (user.icon) {
    return <span className="user-avatar is-emoji" style={{ ...style, fontSize: Math.round(size * 0.62) }} aria-hidden="true">{user.icon}</span>;
  }
  if (user.image && !brokenImages.has(user.image)) {
    return (
      <span className="user-avatar" style={style} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- Google のプロフィール写真（外部 URL）なので next/image の最適化は使わない */}
        <img src={user.image} alt="" referrerPolicy="no-referrer" onError={() => markBroken(user.image!)} />
      </span>
    );
  }
  const initial = [...(user.name?.trim() ?? "")][0]?.toUpperCase() ?? "?";
  return <span className="user-avatar" style={style} aria-hidden="true">{initial || "?"}</span>;
}
