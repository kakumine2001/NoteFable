// 紹介ページのヒーロー3行と <title> は表示言語に関わらず常に英語で固定する。
export const LANDING_HERO = {
  eyebrow: "Personal AI Studio · Chat, Notes, Whiteboards & Slides",
  headlineLead: "Ask it.",
  headlineMark: "Keep it.",
  headlineTail: "Find it again.",
  lede: "Think with multiple AI models, build notes, whiteboards and slides side by side in your Workspace, and recall everything across web, Android and iOS.",
} as const;

export function landingTitle() {
  return `NoteFable — ${LANDING_HERO.headlineLead} ${LANDING_HERO.headlineMark} ${LANDING_HERO.headlineTail}`;
}
