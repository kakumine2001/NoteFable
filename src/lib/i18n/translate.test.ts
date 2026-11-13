import { describe, expect, it } from "vitest";
import { createTranslator, fmt, localizeSystemText, SYSTEM_TEXT_TEMPLATES } from "./translate";
import { messagesFor } from "./messages";

describe("translation interpolation", () => {
  it("inserts values once and leaves unresolved rich-text slots intact", () => {
    const t = createTranslator({ "Hello {name}, {count} notes": "{name}，{count} 条笔记" });
    expect(t("Hello {name}, {count} notes", { name: "{count}", count: 2 })).toBe("{count}，2 条笔记");
    expect(t("Use {key} for commands")).toBe("Use {key} for commands");
    expect(t("Missing {name}", { name: "$&" })).toBe("Missing $&");
  });

  it("requires explicit system context to translate formatted errors and tool labels", () => {
    const t = createTranslator({
      "Request failed: {detail}": "请求失败：{detail}",
      "Note not found.": "找不到笔记。",
      "Searched notes for “{query}”": "搜索了笔记“{query}”",
      "Unsupported file type: {name}": "不支持的文件类型：{name}",
    });
    const failure = fmt("Request failed: {detail}", { detail: "Note not found." });
    expect(t(failure)).toBe(failure);
    expect(localizeSystemText(failure, t)).toBe("请求失败：找不到笔记。");
    expect(localizeSystemText(fmt("Searched notes for “{query}”", { query: "Rayleigh" }), t)).toBe("搜索了笔记“Rayleigh”");
    expect(localizeSystemText(fmt("Request failed: {detail}", { detail: fmt("Unsupported file type: {name}", { name: "a.txt" }) }), t)).toBe("请求失败：不支持的文件类型：a.txt");
    expect(localizeSystemText("Something else", t)).toBe("Something else");
    expect(localizeSystemText("Request failed:", t)).toBe("Request failed:");
  });

  it("falls back to the source without using Object prototype properties", () => {
    const t = createTranslator({});
    expect(t("constructor")).toBe("constructor");
    expect(t("toString", {})).toBe("toString");
    expect(t("{constructor}", {})).toBe("{constructor}");
  });

  it("preserves titles, search terms and filenames that happen to be UI sentences", () => {
    const t = createTranslator({
      "Note not found.": "找不到笔记。",
      "Read “{title}”": "读取了“{title}”",
      "Searched notes for “{query}”": "搜索了“{query}”",
      "Unsupported file type: {name}": "不支持的文件类型：{name}",
    });
    expect(localizeSystemText(fmt("Read “{title}”", { title: "Note not found." }), t)).toBe("读取了“Note not found.”");
    expect(localizeSystemText(fmt("Searched notes for “{query}”", { query: "Note not found." }), t)).toBe("搜索了“Note not found.”");
    expect(localizeSystemText(fmt("Unsupported file type: {name}", { name: "Note not found." }), t)).toBe("不支持的文件类型：Note not found.");
    expect(localizeSystemText(fmt("Read “{title}”", { title: "" }), t)).toBe("读取了“”");
  });

  it("requires explicit variables when multiple placeholders cannot be recovered unambiguously", () => {
    const key = "“{name}” exceeds {size} per file. Choose a smaller file.";
    const t = createTranslator({ [key]: "“{name}”超过 {size}。" });
    const vars = { name: "a” exceeds b.txt", size: "10 MiB" };
    expect(t(key, vars)).toBe("“a” exceeds b.txt”超过 10 MiB。");
    const english = `“${vars.name}” exceeds ${vars.size} per file. Choose a smaller file.`;
    expect(t(english)).toBe(english);
  });

  it("does not confuse a filename suffix with unrelated UI templates", () => {
    const t = createTranslator(messagesFor("zh"));
    const large = fmt("File is too large: {name}", { name: "memo (only the beginning was shared)" });
    expect(localizeSystemText(large, t)).toBe("文件太大：memo (only the beginning was shared)");
    const unsupported = fmt("Unsupported file type: {name}", { name: "memo No new files were added." });
    expect(localizeSystemText(unsupported, t)).toBe("不支持的文件类型：memo No new files were added.");
    expect(t(large)).toBe(large);
    expect(t(unsupported)).toBe(unsupported);
  });

  it("keeps system templates unambiguous even when values contain arbitrary text", () => {
    const prefixes = SYSTEM_TEXT_TEMPLATES.map((key) => {
      const parts = key.split(/\{(\w+)\}/);
      expect(parts).toHaveLength(3);
      expect(parts[0]).not.toBe("");
      return parts[0];
    });
    for (let left = 0; left < prefixes.length; left++) {
      for (let right = left + 1; right < prefixes.length; right++) {
        expect(prefixes[left].startsWith(prefixes[right]) || prefixes[right].startsWith(prefixes[left])).toBe(false);
      }
    }
  });
});
