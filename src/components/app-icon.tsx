"use client";

import { BrandMark } from "@/components/notefable-logo";
import { isImageIcon, useAppIcon } from "@/lib/app-icon";

// ワークスペースのアイコン。設定で替えていればその絵文字・画像を、替えていなければ NoteFable のロゴを出す。
// icon を渡すとその値をそのまま描く（設定画面の見本用）。
export function AppIcon({ size = 20, icon }: { size?: number; icon?: string | null }) {
  const saved = useAppIcon();
  const value = icon === undefined ? saved : icon;
  if (!value) return <BrandMark size={size} />;
  if (isImageIcon(value)) {
    // data URL の小さな画像なので、next/image の最適化は通さない。
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="app-icon-image" src={value} alt="" width={size} height={size} draggable={false} />;
  }
  return <span className="app-icon-emoji" style={{ width: size, height: size, fontSize: size * 0.9 }} aria-hidden="true">{value}</span>;
}
