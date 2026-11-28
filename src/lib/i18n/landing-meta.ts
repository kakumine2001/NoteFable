// 紹介ページのヒーロー（小見出し・見出し 2 行・説明）と <title> は表示言語に関わらず常に英語で固定する。
export const LANDING_HERO = {
  eyebrow: "AI chat with a Workspace built in",
  headlineLead: "Ask anything.",
  headlineTail: "Make it",
  headlineMark: "yours.",
  lede: "NoteFable is the AI chat that doesn't end in a chat log. Turn any answer into notes, slides and whiteboards, then pick up right where you left off.",
} as const;

export function landingTitle() {
  return `NoteFable — ${LANDING_HERO.headlineLead} ${LANDING_HERO.headlineTail} ${LANDING_HERO.headlineMark}`;
}
