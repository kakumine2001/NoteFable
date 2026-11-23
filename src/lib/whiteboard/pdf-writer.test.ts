import { describe, expect, it } from "vitest";
import { buildPdf, fitPageSize, MAX_PDF_PAGE_POINTS, pdfText, rgbaToRgb } from "@/lib/whiteboard/pdf-writer";

const decoder = new TextDecoder("latin1");

describe("buildPdf", () => {
  it("writes one image page per entry with a valid cross-reference table", () => {
    const pdf = buildPdf([
      { width: 400, height: 300, image: { kind: "jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), pixelWidth: 800, pixelHeight: 600 } },
      { width: 200, height: 100, image: { kind: "flate", data: new Uint8Array([1, 2, 3]), pixelWidth: 400, pixelHeight: 200 } },
    ], { title: "Board" });
    const text = decoder.decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 400 300]");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Filter /FlateDecode");
    expect(text).toContain("/Title (Board)");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // 相互参照の各行の位置に、その番号のオブジェクトが本当にある。
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = text.slice(xrefAt).split("\n").slice(3).filter((line) => /^\d{10} 00000 n $/.test(line));
    entries.forEach((line, index) => {
      const offset = Number(line.slice(0, 10));
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    expect(entries).toHaveLength(9);
  });

  it("rejects an empty document", () => {
    expect(() => buildPdf([])).toThrow();
  });
});

describe("pdfText", () => {
  it("escapes ASCII and encodes other text as UTF-16BE", () => {
    expect(pdfText("a(b)\\c")).toBe("(a\\(b\\)\\\\c)");
    expect(pdfText("白板")).toBe("<FEFF767D677F>");
    expect(pdfText("😀")).toBe("<FEFFD83DDE00>");
  });
});

describe("fitPageSize", () => {
  it("keeps the page inside the PDF size limit", () => {
    const size = fitPageSize(MAX_PDF_PAGE_POINTS * 2, 100);
    expect(size.width).toBe(MAX_PDF_PAGE_POINTS);
    expect(size.height).toBe(50);
    expect(fitPageSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("rgbaToRgb", () => {
  it("composites transparent pixels on white", () => {
    expect([...rgbaToRgb(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 128]))]).toEqual([0, 0, 0, 255, 255, 255, 255, 127, 127]);
  });
});
