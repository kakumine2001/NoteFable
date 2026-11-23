import { Converter } from "opencc-js";
import { describe, expect, it } from "vitest";
import { toTraditional, ZH_HANT_TERMS } from "../../scripts/zh-hant-terms";

describe("Traditional Chinese conversion with product terms", () => {
  const plain = Converter({ from: "cn", to: "twp" });

  it("uses the Taiwanese product terms where OpenCC would not", () => {
    expect(plain("幻灯片")).not.toBe("投影片");
    expect(toTraditional("幻灯片")).toBe("投影片");
    expect(toTraditional("此页面是幻灯片，不是笔记。")).toBe("此頁面是投影片，不是筆記。");
    expect(toTraditional("新建思维导图和便签")).toBe("新建心智圖和便利貼");
  });

  it("converts everything else exactly like OpenCC", () => {
    for (const text of ["白板编辑功能即将推出。", "只有笔记可以导出为 Markdown。", "数据", "{max} 个文件"]) expect(toTraditional(text)).toBe(plain(text));
  });

  it("keeps the table to simplified → traditional pairs that differ", () => {
    for (const [simplified, traditional] of ZH_HANT_TERMS) {
      expect(simplified).not.toBe(traditional);
      expect(toTraditional(`「${simplified}」`)).toBe(`「${traditional}」`);
    }
  });
});
