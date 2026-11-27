// iOS の App Store 用スクリーンショットで、アプリが本物のウェブエディターで開く 2 ページ（思考マップとスライド）の中身を作る。
// CI はこれを POST /api/pages の本文としてそのまま手元のサーバーに送る（mobile/ios/scripts/ci-store-server.sh）。AI は呼ばない。
// 題名は iOS のストア用データ（mobile/ios/NoteFable/Core/App/FixtureStoreData.swift）と同じにする。
//   node node_modules/tsx/dist/cli.mjs scripts/gen-ios-store-seed.ts
// src/lib/ios-store-seed.test.ts が、本体の検証と題名の食い違いを見る。
import { mkdirSync, writeFileSync } from "node:fs";
import { createSlide } from "../src/lib/slides/layouts";
import { normalizeDeck } from "../src/lib/slides/model";
import { diagramToWhiteboard } from "../src/lib/whiteboard/diagram";

const DIRECTORY = "mobile/ios/app-store/seed";

// 根の子は 3 つ（右へ伸びる配置になり、縦長の画面で読める大きさになる）。
const MINDMAP = `mindmap
  root((Photosynthesis))
    Light reactions
      Thylakoids
      Splits water
      Makes ATP
    Calvin cycle
      Stroma
      Fixes CO₂
      Builds sugar
    What plants need
      Sunlight
      Water
      CO₂`;

function write(file: string, page: { kind: "whiteboard" | "slides"; title: string; icon: string | null; data: unknown }) {
  writeFileSync(`${DIRECTORY}/${file}`, `${JSON.stringify(page, null, 2)}\n`);
  console.log(`wrote ${DIRECTORY}/${file}`);
}

async function main() {
  mkdirSync(DIRECTORY, { recursive: true });
  const { data } = await diagramToWhiteboard(MINDMAP);
  write("mindmap.json", { kind: "whiteboard", title: "Photosynthesis Mind Map", icon: null, data });
  // Google Play のスライドと同じ構成（表紙・要点・2 段・引用）と主題。
  write("deck.json", {
    kind: "slides",
    title: "Photosynthesis Review",
    icon: null,
    data: normalizeDeck({
      theme: { id: "grotesk", mode: "dark" },
      slides: [
        createSlide("title", { title: "Photosynthesis", subtitle: "How plants turn light into food" }),
        createSlide("bullets", { title: "Two stages", body: "Light reactions capture energy\nThe Calvin cycle builds sugar\nOxygen is released" }),
        createSlide("twoColumn", { title: "In and out", body: "Sunlight\nWater\nCarbon dioxide", body2: "Glucose\nOxygen" }),
        createSlide("quote", { quote: "Light energy becomes chemical energy.", attribution: "Biology exam review" }),
      ],
    }),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
