import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCanvasPage } from "@/lib/canvas-document";
import { normalizeDeck } from "@/lib/slides/model";
import { storedToScene } from "@/lib/whiteboard/scene";

// iOS の App Store 用スクリーンショットで CI が手元のサーバーに入れる 2 ページ（scripts/gen-ios-store-seed.ts で作る）。
// 本体の形が変わったら作り直す。アプリの一覧（FixtureStoreData.swift）の題名・アイコン・ID とも食い違わないこと。
const SEEDS = [
  { file: "mindmap.json", kind: "whiteboard", id: "board" },
  { file: "deck.json", kind: "slides", id: "deck" },
] as const;

const seed = (file: string) => JSON.parse(readFileSync(`mobile/ios/app-store/seed/${file}`, "utf8"));
const storeData = readFileSync("mobile/ios/NoteFable/Core/App/FixtureStoreData.swift", "utf8");
const serverScript = readFileSync("mobile/ios/scripts/ci-store-server.sh", "utf8");

describe("iOS store screenshot seed pages", () => {
  it.each(SEEDS)("$file passes the validation of POST /api/pages", ({ file, kind }) => {
    const page = seed(file);
    expect(page.kind).toBe(kind);
    const checked = validateCanvasPage(kind, page);
    expect(checked).toMatchObject({ title: page.title, icon: page.icon, data: page.data, filePaths: [] });
  });

  it("has nothing the editor would drop or repair", () => {
    const board = seed("mindmap.json").data;
    expect(storedToScene(board).elements).toHaveLength(board.elements.length);
    const deck = seed("deck.json").data;
    expect(normalizeDeck(deck)).toEqual(deck);
  });

  it.each(SEEDS)("$file is listed by the app under the id CI gives it", ({ file, kind, id }) => {
    const page = seed(file);
    const icon = page.icon === null ? "nil" : JSON.stringify(page.icon);
    expect(storeData).toContain(`static let ${id} = "fx-store-${id}"`);
    expect(storeData).toContain(`Page(id: IDs.${id}, kind: .${kind}, title: ${JSON.stringify(page.title)}, icon: ${icon},`);
    expect(serverScript).toContain(`SET id = 'fx-store-${id}'`);
  });
});
