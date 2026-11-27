// 生成原生 Android / iOS 白板提案说明翻译的对照用例（说明见 scripts/native-whiteboard-proposal-cases.ts）。
// 改了 src/lib/whiteboard/proposal-text.ts 之后运行：npx tsx scripts/gen-native-whiteboard-proposal-cases.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IOS_WHITEBOARD_PROPOSAL_CASES, NATIVE_WHITEBOARD_PROPOSAL_CASES, nativeWhiteboardProposalCases } from "./native-whiteboard-proposal-cases";

const cases = nativeWhiteboardProposalCases();
for (const file of [NATIVE_WHITEBOARD_PROPOSAL_CASES, IOS_WHITEBOARD_PROPOSAL_CASES]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, cases);
  console.log(`wrote ${file}`);
}
