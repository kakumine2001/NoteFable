"use client";

import EmojiPicker, { Categories, EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";
import emojiData from "emoji-picker-react/data/emojis-en";
import { Shuffle } from "lucide-react";
import { useMemo } from "react";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { useI18n } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

// 選んだ言語の検索用データだけを追加で読み込む。別言語を初期バンドルに含めない。
const EMOJI_DATA = {
  en: emojiData,
  zh: () => import("emoji-picker-react/data/emojis-zh"),
  ja: () => import("emoji-picker-react/data/emojis-ja"),
};

const EMOJI_CATEGORIES = [
  { category: Categories.SUGGESTED, name: msg("Recently used") },
  { category: Categories.SMILEYS_PEOPLE, name: msg("Smileys & people") },
  { category: Categories.ANIMALS_NATURE, name: msg("Animals & nature") },
  { category: Categories.FOOD_DRINK, name: msg("Food & drink") },
  { category: Categories.TRAVEL_PLACES, name: msg("Travel & places") },
  { category: Categories.ACTIVITIES, name: msg("Activities") },
  { category: Categories.OBJECTS, name: msg("Objects") },
  { category: Categories.SYMBOLS, name: msg("Symbols") },
  { category: Categories.FLAGS, name: msg("Flags") },
];

const randomEmojis = Object.values(emojiData.emojis).flat()
  .map((item) => String.fromCodePoint(...item.u.split("-").map((part) => parseInt(part, 16))))
  .filter(isEmojiIcon);

export default function FullEmojiPicker({ current, removeLabel, onChange, onClose }: {
  current: string | null;
  removeLabel: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  // 毎回新しい設定を渡すと選択器が設定の変化とみなすので、言語（t）が変わるときだけ作り直す。
  const categories = useMemo(() => EMOJI_CATEGORIES.map((category) => ({ ...category, name: t(category.name) })), [t]);
  const labels = useMemo(() => ({
    searchPlaceholder: t("Search emoji…"),
    searchLabel: t("Search for an emoji"),
    searchClear: t("Clear search"),
    searchResultsNone: t("No emoji found"),
    searchResultsOne: t("1 emoji found. Use the up and down arrow keys to navigate."),
    searchResultsMany: t("{count} emoji found. Use the up and down arrow keys to navigate.", { count: "%n" }),
    categoryNavigation: t("Emoji categories"),
    reactions: t("Reactions"),
    expandReactions: t("Show all emoji"),
    loading: t("Loading emoji…"),
    loadingError: t("Could not load emoji."),
    retryLoading: t("Try again"),
    skinToneNeutral: t("Default skin tone"),
    skinToneLight: t("Light skin tone"),
    skinToneMediumLight: t("Medium-light skin tone"),
    skinToneMedium: t("Medium skin tone"),
    skinToneMediumDark: t("Medium-dark skin tone"),
    skinToneDark: t("Dark skin tone"),
  }), [t]);
  return <div className="full-emoji-picker">
    <div className="notes-picker-bar">
      <span>{t("Emoji")}{current && <span className="emoji-picker-current" aria-label={t("Current emoji")}> {current}</span>}</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => onChange(randomEmojis[Math.floor(Math.random() * randomEmojis.length)])}><Shuffle size={13} />{t("Random")}</button>
        <button type="button" onClick={() => { onChange(null); onClose(); }}>{removeLabel}</button>
      </div>
    </div>
    <EmojiPicker width="100%" height="var(--emoji-picker-height)" theme={Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE} suggestedEmojisMode={SuggestionMode.RECENT}
      previewConfig={{ showPreview: false }} emojiData={EMOJI_DATA[locale]}
      categories={categories}
      labels={labels}
      onEmojiClick={(item) => { onChange(item.emoji); onClose(); }} />
  </div>;
}
