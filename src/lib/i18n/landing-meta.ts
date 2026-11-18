// 紹介ページのヒーロー3行と <title> は表示言語に関わらず常に英語で固定する。
export const LANDING_HERO = {
  eyebrow: "AI chat and notes, in one place",
  headlineLead: "Ask it.",
  headlineMark: "Keep it.",
  headlineTail: "Find it again.",
  lede: "NoteFable is a study space where a question becomes an answer, the answer becomes a note, and the note is still there when you need it.",
} as const;

export function landingTitle() {
  return `NoteFable — ${LANDING_HERO.headlineLead} ${LANDING_HERO.headlineMark} ${LANDING_HERO.headlineTail}`;
}
