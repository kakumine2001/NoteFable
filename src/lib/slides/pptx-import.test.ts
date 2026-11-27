import JSZip from "jszip";
import { DOMParser as LinkedomDOMParser } from "linkedom";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it, vi } from "vitest";
import { noteFileUrl } from "@/lib/note-file-keys";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type Deck,
  type ImageElement,
  type LineElement,
  type ShapeElement,
  type TableElement,
  type TextElement,
} from "@/lib/slides/model";
import { richDocText } from "@/lib/slides/rich-text";
import { probePptxImage } from "@/lib/slides/pptx/image-probe";
import { parsePptx, safePptxHref } from "@/lib/slides/pptx/parse";
import { importPptxFile, MAX_PPTX_FILE_BYTES, PptxImportError, type XmlParserLike } from "@/lib/slides/pptx-import";
import { StorageLimitError } from "@/lib/usage-plans";
import type { NotePageSummary } from "@/types/notes";

// linkedom の DOMParser をブラウザと同じインタフェースで渡す。
const xmlParser: XmlParserLike = {
  parseFromString: (xml: string, type: "application/xml" | "text/xml") =>
    new LinkedomDOMParser().parseFromString(xml, type === "application/xml" ? "text/xml" : type) as unknown as Document,
};

// 最小の有効な 1×1 PNG（67 バイト）と 2×2 PNG。
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_BYTES = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

function makeFakePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(TINY_PNG_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeFakeGif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(14);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  bytes[6] = width & 0xff;
  bytes[7] = (width >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >> 8) & 0xff;
  return bytes;
}

function makeFakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // dummy APP0
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ]);
}

function makeFakeWebpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from("RIFF"), 0);
  bytes.set(Buffer.from("WEBP"), 8);
  bytes.set(Buffer.from("VP8X"), 12);
  const w1 = width - 1;
  const h1 = height - 1;
  bytes[24] = w1 & 0xff; bytes[25] = (w1 >> 8) & 0xff; bytes[26] = (w1 >> 16) & 0xff;
  bytes[27] = h1 & 0xff; bytes[28] = (h1 >> 8) & 0xff; bytes[29] = (h1 >> 16) & 0xff;
  return bytes;
}

function makeFakeEmf(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[0] = 1; // EMR_HEADER
  bytes.set(Buffer.from(" EMF"), 40);
  return bytes;
}

function makeFileFromBytes(bytes: Uint8Array, name = "deck.pptx", type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], name, { type });
  // Node / jsdom 環境でも確実に arrayBuffer() が動くように保証する。
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => copy.buffer });
  }
  return file;
}

function fakePageSummary(id: string, title: string): NotePageSummary {
  const now = new Date().toISOString();
  return { id, kind: "slides", title, icon: null, cover: null, coverPosition: 50, version: 1, groupId: null, parentId: null, createdAt: now, updatedAt: now };
}

// テスト用の標準 OOXML 骨格を作るヘルパー（PowerPoint / Google スライド / LibreOffice の各記法を再現する）。
async function buildCustomPptx(parts: Record<string, string | Uint8Array>, compression: "STORE" | "DEFLATE" = "DEFLATE"): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) {
    zip.file(path, content, { compression, compressionOptions: { level: 9 } });
  }
  return zip.generateAsync({ type: "uint8array", compression, compressionOptions: { level: 9 } });
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DEFAULT_THEME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Custom">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:srgbClr val="112233"/></a:dk1>
      <a:lt1><a:srgbClr val="FAF8F5"/></a:lt1>
      <a:dk2><a:srgbClr val="223344"/></a:dk2>
      <a:lt2><a:srgbClr val="EAE6DF"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
      <a:accent2><a:srgbClr val="E11D48"/></a:accent2>
      <a:accent3><a:srgbClr val="10B981"/></a:accent3>
      <a:accent4><a:srgbClr val="8B5CF6"/></a:accent4>
      <a:accent5><a:srgbClr val="0EA5E9"/></a:accent5>
      <a:accent6><a:srgbClr val="F59E0B"/></a:accent6>
      <a:hlink><a:srgbClr val="1D4ED8"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Editorial">
      <a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont>
      <a:minorFont><a:latin typeface="Source Serif 4"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

describe("PPTX image probe & href validation", () => {
  it("accepts PNG, JPEG, GIF, WebP and extracts exact headers without decoding", () => {
    expect(probePptxImage(TINY_PNG_BYTES)).toEqual({ ok: true, mimeType: "image/png", width: 1, height: 1 });
    expect(probePptxImage(makeFakeGif(640, 480))).toEqual({ ok: true, mimeType: "image/gif", width: 640, height: 480 });
    expect(probePptxImage(makeFakeJpeg(1920, 1080))).toEqual({ ok: true, mimeType: "image/jpeg", width: 1920, height: 1080 });
    expect(probePptxImage(makeFakeWebpVp8x(800, 600))).toEqual({ ok: true, mimeType: "image/webp", width: 800, height: 600 });
  });

  it("rejects EMF, WMF, SVG and oversized image dimensions before decoding", () => {
    expect(probePptxImage(makeFakeEmf(), "ppt/media/image1.emf")).toEqual({ ok: false, reason: "unsupported", detectedFormat: "emf" });
    expect(probePptxImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "ppt/media/a.svg")).toEqual({ ok: false, reason: "unsupported", detectedFormat: "svg" });
    expect(probePptxImage(new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0]), "ppt/media/a.wmf")).toEqual({ ok: false, reason: "unsupported", detectedFormat: "wmf" });
    expect(probePptxImage(makeFakePngHeader(50_000, 50_000))).toEqual({ ok: false, reason: "oversized" });
    expect(probePptxImage(makeFakePngHeader(6000, 5000))).toEqual({ ok: false, reason: "oversized" }); // 30 MP > 25 MP
  });

  it("allows only http, https and mailto links", () => {
    expect(safePptxHref("https://example.com/path")).toBe("https://example.com/path");
    expect(safePptxHref("http://example.com")).toBe("http://example.com");
    expect(safePptxHref("mailto:team@example.com")).toBe("mailto:team@example.com");
    expect(safePptxHref("javascript:alert(1)")).toBeNull();
    expect(safePptxHref("file:///etc/passwd")).toBeNull();
    expect(safePptxHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safePptxHref("tel:+819012345678")).toBeNull();
  });
});

describe("Case 1: NoteFable PptxGenJS export round-trip", () => {
  it("imports a NoteFable-style PptxGenJS deck nearly losslessly", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = "Quarterly Review";
    pptx.theme = { headFontFace: "Playfair Display", bodyFontFace: "Source Serif 4" };

    // Slide 1: rich text, bullet & ordered lists, shape, arrow line, image, speaker notes
    const s1 = pptx.addSlide();
    s1.background = { color: "FBF8F3" };
    s1.addText(
      [
        { text: "Quarterly ", options: { fontFace: "Playfair Display", fontSize: 36, color: "1A1512", bold: true } },
        { text: "Review", options: { fontFace: "Playfair Display", fontSize: 36, color: "9B2C2C", bold: true, italic: true, underline: { style: "sng" }, hyperlink: { url: "https://notefable.app" } } },
      ],
      { x: 1, y: 0.5, w: 10, h: 1.2, valign: "top", isTextBox: true },
    );
    s1.addText(
      [
        { text: "Alpha point", options: { fontFace: "Source Serif 4", fontSize: 18, color: "2B2622", bullet: true, breakLine: true } },
        { text: "Beta point", options: { fontFace: "Source Serif 4", fontSize: 18, color: "2B2622", bullet: true } },
      ],
      { x: 1, y: 2, w: 5, h: 2, valign: "top", isTextBox: true },
    );
    s1.addText("Step A", {
      x: 7, y: 2, w: 3, h: 1.5, shape: pptx.ShapeType.roundRect,
      fill: { color: "9B2C2C" }, line: { color: "1A1512", width: 2, dashType: "dash" },
      color: "FFFFFF", fontSize: 20, align: "center", valign: "middle", rotate: 15,
    });
    s1.addShape(pptx.ShapeType.line, {
      x: 1, y: 5, w: 4, h: 1, flipH: true, flipV: false,
      line: { color: "2C5282", width: 3, dashType: "sysDot", beginArrowType: "oval", endArrowType: "arrow" },
    });
    s1.addImage({
      data: `image/png;base64,${TINY_PNG_BASE64}`,
      x: 7, y: 4.5, w: 3, h: 2, altText: "Chart snapshot",
    });
    s1.addNotes("Remember to pause for questions.");

    // Slide 2: hidden slide with table
    const s2 = pptx.addSlide();
    s2.hidden = true;
    s2.background = { color: "FFFFFF" };
    s2.addTable(
      [
        [{ text: "Metric", options: { bold: true, fill: { color: "F0EBE1" } } }, { text: "Q4", options: { bold: true, fill: { color: "F0EBE1" } } }],
        [{ text: "Users" }, { text: "12,400" }],
      ],
      { x: 1, y: 1, w: 8, colW: [5, 3], rowH: 0.75, fontSize: 14, color: "2B2622", border: { type: "solid", pt: 0.75, color: "D8CFC2" } },
    );

    const bytes = await pptx.write({ outputType: "uint8array", compression: true }) as Uint8Array;
    const parsed = await parsePptx(bytes, { fileName: "fallback.pptx", xmlParser });

    expect(parsed.title).toBe("Quarterly Review");
    expect(parsed.deck.theme).toEqual({ id: "editorial", mode: "light" });
    expect(parsed.deck.slides).toHaveLength(2);
    expect(parsed.report.totalUnsupported).toBe(0);

    const slide1 = parsed.deck.slides[0];
    expect(slide1.background).toBe("#fbf8f3");
    expect(slide1.hidden).toBeUndefined();
    expect(slide1.notes).toBe("Remember to pause for questions.");

    // Title text box position (1 in * 144 = 144px, 0.5 in * 144 = 72px, 36pt * 2 = 72px)
    const texts = slide1.elements.filter((e): e is TextElement => e.type === "text");
    expect(texts.length).toBeGreaterThanOrEqual(2);
    const titleEl = texts[0];
    expect(titleEl.x).toBeCloseTo(144, 0);
    expect(titleEl.y).toBeCloseTo(72, 0);
    expect(titleEl.w).toBeCloseTo(1440, 0);
    expect(titleEl.style.size).toBe(72);
    expect(titleEl.style.bold).toBe(true);
    expect(richDocText(titleEl.doc)).toBe("Quarterly Review");
    // Second run preserves link, italic, underline, inline color
    const firstPara = titleEl.doc.content[0];
    expect(firstPara.type).toBe("paragraph");
    const reviewNode = firstPara.type === "paragraph" ? firstPara.content?.[1] : undefined;
    expect(reviewNode?.type).toBe("text");
    const marks = reviewNode?.type === "text" ? reviewNode.marks ?? [] : [];
    expect(marks).toContainEqual({ type: "link", attrs: { href: "https://notefable.app" } });
    expect(marks).toContainEqual({ type: "em" });
    expect(marks).toContainEqual({ type: "underline" });
    expect(marks).toContainEqual({ type: "color", attrs: { color: "#9b2c2c" } });

    // Bullet list preserved
    const bulletEl = texts[1];
    expect(bulletEl.doc.content[0]?.type).toBe("bullet_list");
    expect(richDocText(bulletEl.doc)).toBe("Alpha point\nBeta point");

    // Shape preserved
    const shape = slide1.elements.find((e): e is ShapeElement => e.type === "shape")!;
    expect(shape).toBeDefined();
    expect(shape.shape).toBe("roundRect");
    expect(shape.fill).toBe("#9b2c2c");
    expect(shape.stroke).toBe("#1a1512");
    expect(shape.dash).toBe("dash");
    expect(shape.rotation).toBeCloseTo(15, 0);
    expect(richDocText(shape.doc)).toBe("Step A");

    // Line preserved with flipH, arrowheads, dash
    const line = slide1.elements.find((e): e is LineElement => e.type === "line")!;
    expect(line).toBeDefined();
    expect(line.x).toBeCloseTo(144, 0);
    expect(line.y).toBeCloseTo(720, 0);
    expect(line.w).toBeCloseTo(576, 0);
    expect(line.h).toBeCloseTo(144, 0);
    expect(line.flipH).toBe(true);
    expect(line.flipV).toBe(false);
    expect(line.dash).toBe("dot");
    expect(line.start).toBe("oval");
    expect(line.end).toBe("arrow");
    expect(line.strokeWidth).toBeCloseTo(6, 0);

    // Image preserved
    const img = slide1.elements.find((e): e is ImageElement => e.type === "image")!;
    expect(img).toBeDefined();
    expect(img.x).toBeCloseTo(1008, 0);
    expect(img.w).toBeCloseTo(432, 0);
    expect(img.alt).toBe("Chart snapshot");
    expect(parsed.images).toHaveLength(1);

    // Slide 2 hidden + table preserved
    const slide2 = parsed.deck.slides[1];
    expect(slide2.hidden).toBe(true);
    const table = slide2.elements.find((e): e is TableElement => e.type === "table")!;
    expect(table).toBeDefined();
    expect(table.header).toBe(true);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(["Metric", "Q4"]);
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(["Users", "12,400"]);
    expect(table.style.headerFill).toBe("#f0ebe1");
    expect(table.cols[0]).toBeGreaterThan(table.cols[1]);
  });
});

describe("Case 2: External styles (PowerPoint, Google Slides, LibreOffice Impress)", () => {
  it("handles PowerPoint master/layout placeholders, theme colors, group transforms, sections, static previews, and per-slide compatibility reports", async () => {
    const pptxBytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PowerPoint Deck</dc:title></cp:coreProperties>`,
      "ppt/theme/theme1.xml": DEFAULT_THEME_XML,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
        </Relationships>`,
      "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Master Accent Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="127000"/></a:xfrm>
                  <a:prstGeom prst="rect"/>
                  <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
                </p:spPr>
              </p:sp>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="3" name="Master Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="635000" y="381000"/><a:ext cx="10922000" cy="1016000"/></a:xfrm></p:spPr>
              </p:sp>
            </p:spTree>
          </p:cSld>
          <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
          <p:txStyles>
            <p:titleStyle>
              <a:lvl1pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="accent1"><a:shade val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr>
            </p:titleStyle>
            <p:bodyStyle>
              <a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr>
            </p:bodyStyle>
          </p:txStyles>
        </p:sldMaster>`,
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
        </Relationships>`,
      "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Layout Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="635000" y="508000"/><a:ext cx="10922000" cy="952500"/></a:xfrm></p:spPr>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:sldLayout>`,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
          <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>
          <p:sldIdLst>
            <p:sldId id="256" r:id="rId1"/>
            <p:sldId id="257" r:id="rId2"/>
          </p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">
            <p14:sectionLst>
              <p14:section name="Intro"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section>
              <p14:section name="Deep Dive"><p14:sldIdLst><p14:sldId id="257"/></p14:sldIdLst></p14:section>
            </p14:sectionLst>
          </p:ext></p:extLst>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
          <Relationship Id="rIdChartImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart-preview.png"/>
          <Relationship Id="rIdVideoPoster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/video-poster.png"/>
          <Relationship Id="rIdEmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vector.emf"/>
        </Relationships>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">
          <p:cSld>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <!-- Placeholder inherits xfrm from layout and color/size/align from master titleStyle -->
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:spPr/>
                <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Inherited Title</a:t></a:r></a:p></p:txBody>
              </p:sp>
              <!-- Nested group with 2x scale and translation -->
              <p:grpSp>
                <p:nvGrpSpPr><p:cNvPr id="10" name="Group 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
                <p:grpSpPr>
                  <a:xfrm>
                    <a:off x="1270000" y="1905000"/><a:ext cx="2540000" cy="1270000"/>
                    <a:chOff x="100000" y="100000"/><a:chExt cx="1270000" cy="635000"/>
                  </a:xfrm>
                </p:grpSpPr>
                <p:sp>
                  <p:nvSpPr><p:cNvPr id="11" name="Badge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                  <p:spPr>
                    <a:xfrm><a:off x="100000" y="100000"/><a:ext cx="635000" cy="317500"/></a:xfrm>
                    <a:prstGeom prst="diamond"/>
                  </p:spPr>
                  <p:style><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:lnRef idx="0"/><a:fontRef idx="minor"/></p:style>
                  <p:txBody><a:bodyPr/><a:p><a:r><a:t>KPI</a:t></a:r></a:p></p:txBody>
                </p:sp>
              </p:grpSp>
              <!-- Chart with mc:Fallback static preview PNG -->
              <mc:AlternateContent>
                <mc:Choice Requires="cx1">
                  <p:graphicFrame>
                    <p:nvGraphicFramePr><p:cNvPr id="20" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
                    <p:xfrm><a:off x="5080000" y="1905000"/><a:ext cx="3175000" cy="1905000"/></p:xfrm>
                    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="rIdMissingChart"/></a:graphicData></a:graphic>
                  </p:graphicFrame>
                </mc:Choice>
                <mc:Fallback>
                  <p:pic>
                    <p:nvPicPr><p:cNvPr id="21" name="Chart Fallback"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                    <p:blipFill><a:blip r:embed="rIdChartImg"/></p:blipFill>
                    <p:spPr><a:xfrm><a:off x="5080000" y="1905000"/><a:ext cx="3175000" cy="1905000"/></a:xfrm></p:spPr>
                  </p:pic>
                </mc:Fallback>
              </mc:AlternateContent>
              <!-- Video with poster frame PNG -->
              <p:pic>
                <p:nvPicPr><p:cNvPr id="22" name="Demo Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdVid"/></p:nvPr></p:nvPicPr>
                <p:blipFill><a:blip r:embed="rIdVideoPoster"/></p:blipFill>
                <p:spPr><a:xfrm><a:off x="8890000" y="1905000"/><a:ext cx="2540000" cy="1905000"/></a:xfrm></p:spPr>
              </p:pic>
              <!-- Unsupported EMF image -->
              <p:pic>
                <p:nvPicPr><p:cNvPr id="23" name="Vector EMF"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                <p:blipFill><a:blip r:embed="rIdEmf"/></p:blipFill>
                <p:spPr><a:xfrm><a:off x="635000" y="4445000"/><a:ext cx="1270000" cy="1270000"/></a:xfrm></p:spPr>
              </p:pic>
            </p:spTree>
          </p:cSld>
          <p:transition><p:blinds/></p:transition>
          <p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:anim><p:cBhvr><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>
        </p:sld>`,
      "ppt/slides/_rels/slide2.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        </Relationships>`,
      "ppt/slides/slide2.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" showMasterSp="0">
          <p:cSld>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:graphicFrame>
                <p:nvGraphicFramePr><p:cNvPr id="30" name="SmartArt 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
                <p:xfrm><a:off x="635000" y="635000"/><a:ext cx="5080000" cy="3175000"/></p:xfrm>
                <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rId1"/></a:graphicData></a:graphic>
              </p:graphicFrame>
            </p:spTree>
          </p:cSld>
        </p:sld>`,
      "ppt/media/chart-preview.png": TINY_PNG_BYTES,
      "ppt/media/video-poster.png": TINY_PNG_BYTES,
      "ppt/media/vector.emf": makeFakeEmf(),
    });

    const parsed = await parsePptx(pptxBytes, { xmlParser });
    expect(parsed.title).toBe("PowerPoint Deck");
    expect(parsed.deck.slides).toHaveLength(2);

    const s1 = parsed.deck.slides[0];
    expect(s1.section).toBe("Intro");
    expect(s1.background).toBe("#faf8f5"); // inherited from master bg1 -> lt1

    // Master non-placeholder accent bar included on slide 1 (showMasterSp default true)
    const masterBar = s1.elements.find((e): e is ShapeElement => e.type === "shape" && e.fill === "#2563eb");
    expect(masterBar).toBeDefined();
    expect(masterBar!.w).toBeCloseTo(1920, 0);

    // Title inherited layout xfrm (635000 / 6350 = 100, 508000 / 6350 = 80) and master titleStyle (40pt -> 80px, bold, center, accent1 shaded 75%)
    const titleEl = s1.elements.find((e): e is TextElement => e.type === "text" && richDocText(e.doc) === "Inherited Title")!;
    expect(titleEl).toBeDefined();
    expect(titleEl.x).toBeCloseTo(100, 0);
    expect(titleEl.y).toBeCloseTo(80, 0);
    expect(titleEl.style.size).toBe(80);
    expect(titleEl.style.bold).toBe(true);
    expect(titleEl.style.align).toBe("center");
    // #2563EB * 0.75 = (37*0.75=28=1c, 99*0.75=74=4a, 235*0.75=176=b0) -> #1c4ab0
    expect(titleEl.style.color).toBe("#1c4ab0");

    // Grouped diamond scaled 2x: group off=(1270000,1905000) = (200px,300px), child w=635000*2=1270000=200px, h=317500*2=635000=100px
    const diamond = s1.elements.find((e): e is ShapeElement => e.type === "shape" && e.shape === "diamond")!;
    expect(diamond).toBeDefined();
    expect(diamond.group).toBeTruthy();
    expect(diamond.x).toBeCloseTo(200, 0);
    expect(diamond.y).toBeCloseTo(300, 0);
    expect(diamond.w).toBeCloseTo(200, 0);
    expect(diamond.h).toBeCloseTo(100, 0);
    expect(diamond.fill).toBe("#e11d48"); // resolved from p:style fillRef accent2

    // Static previews placed for chart fallback AND video poster
    const imgs = s1.elements.filter((e): e is ImageElement => e.type === "image");
    expect(imgs).toHaveLength(2);
    expect(imgs.map((i) => i.alt)).toEqual(["Chart Fallback", "Demo Video"]);

    // Slide 2: showMasterSp="0" suppressed master bar, section="Deep Dive", SmartArt reported
    const s2 = parsed.deck.slides[1];
    expect(s2.section).toBe("Deep Dive");
    expect(s2.elements.filter((e) => e.type === "shape")).toHaveLength(0);

    // Per-slide compatibility report
    expect(parsed.report.slides).toHaveLength(2);
    const r1 = parsed.report.slides[0];
    expect(r1.slideNumber).toBe(1);
    expect(r1.slideTitle).toBe("Inherited Title");
    expect(r1.issues).toEqual(expect.arrayContaining([
      { kind: "chart", count: 1, previewCount: 1 },
      { kind: "video", count: 1, previewCount: 1 },
      { kind: "unsupportedImage", count: 1, previewCount: 0 },
      { kind: "transition", count: 1, previewCount: 0 },
      { kind: "animation", count: 1, previewCount: 0 },
    ]));
    const r2 = parsed.report.slides[1];
    expect(r2.slideNumber).toBe(2);
    expect(r2.issues).toEqual([{ kind: "smartart", count: 1, previewCount: 0 }]);
    expect(parsed.report.totalPreviews).toBe(2);
  });

  it("handles Google Slides 10x5.625in scaling and LibreOffice 4:3 aspect-ratio fit", async () => {
    // Google Slides style: 10×5.625 in (9144000 × 5143500 EMU), 24pt font -> 64px, fade transition
    const gslides = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="9144000" cy="5143500"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:bg><p:bgPr><a:solidFill><a:srgbClr val="111827"/></a:solidFill></p:bgPr></p:bg>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="4572000" cy="1028700"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2400"><a:solidFill><a:prstClr val="white"/></a:solidFill></a:rPr><a:t>Google Slides</a:t></a:r></a:p></p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
          <p:transition><p:fade/></p:transition>
        </p:sld>`,
    });
    const gp = await parsePptx(gslides, { fileName: "google-deck.pptx", xmlParser });
    expect(gp.title).toBe("google-deck");
    expect(gp.deck.theme.mode).toBe("dark");
    expect(gp.deck.slides[0].transition).toBe("fade");
    const gText = gp.deck.slides[0].elements[0] as TextElement;
    expect(gText.x).toBeCloseTo(192, 0); // 10% of 1920
    expect(gText.y).toBeCloseTo(108, 0); // 10% of 1080
    expect(gText.w).toBeCloseTo(960, 0); // 50% of 1920
    expect(gText.style.size).toBe(64); // 24pt scaled from 5.625in to 1080px
    expect(gText.style.color).toBe("#ffffff");

    // LibreOffice style: 4:3 (9144000 × 6858000 EMU) -> centered 1440×1080 inside 1920×1080 (offsetX = 240)
    const libre = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="9144000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
        </Relationships>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Full"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"><a:solidFill><a:sysClr val="windowText"/></a:solidFill></a:rPr><a:t>4:3 Impress</a:t></a:r></a:p></p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:sld>`,
      "ppt/notesSlides/notesSlide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:sp><p:nvSpPr><p:cNvPr id="2" name="Num"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp>
            <p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Impress speaker note</a:t></a:r></a:p></p:txBody></p:sp>
          </p:spTree></p:cSld>
        </p:notes>`,
    });
    const lp = await parsePptx(libre, { xmlParser });
    const lText = lp.deck.slides[0].elements[0] as TextElement;
    expect(lText.x).toBeCloseTo(240, 0);
    expect(lText.y).toBeCloseTo(0, 0);
    expect(lText.w).toBeCloseTo(1440, 0);
    expect(lText.h).toBeCloseTo(SLIDE_HEIGHT, 0);
    expect(lText.x + lText.w).toBeLessThan(SLIDE_WIDTH);
    expect(lText.style.color).toBe("#000000");
    expect(lp.deck.slides[0].notes).toBe("Impress speaker note");
  });
});

describe("Case 3: Security, hard limits, and upload cleanup", () => {
  it("stops a zip bomb via streamed uncompressed byte budget", async () => {
    // 5 MiB のゼロバイト XML は圧縮すると数 KB だが、上限を 512 KiB にして実ストリーム中断を検証する。
    const hugePadding = " ".repeat(5 * 1024 * 1024);
    const bomb = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><!--${hugePadding}--></p:presentation>`,
    });
    expect(bomb.byteLength).toBeLessThan(20_000);
    await expect(parsePptx(bomb, { xmlParser, maxUncompressedBytes: 512 * 1024 }))
      .rejects.toMatchObject({ code: "zip_too_large" });
  });

  it("rejects XML with DOCTYPE / ENTITY (XXE)", async () => {
    const xxe = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    });
    await expect(parsePptx(xxe, { xmlParser })).rejects.toMatchObject({ code: "unsafe_archive" });
  });

  it("rejects path traversal entries in ZIP", async () => {
    const zip = new JSZip();
    zip.file("../evil.xml", "<evil/>");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parsePptx(bytes, { xmlParser })).rejects.toMatchObject({ code: "unsafe_archive" });
  });

  it("rejects presentations over 200 slides and files over 50 MB", async () => {
    const sldIds = Array.from({ length: 201 }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");
    const many = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${sldIds}</p:sldIdLst></p:presentation>`,
    });
    await expect(parsePptx(many, { xmlParser })).rejects.toMatchObject({ code: "too_many_slides" });

    const oversizedFile = { name: "huge.pptx", type: "", size: MAX_PPTX_FILE_BYTES + 1 } as File;
    await expect(importPptxFile(oversizedFile, { xmlParser })).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("ignores external relationships, blocks pixel-bomb images, and strips dangerous hyperlinks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const evil = await buildCustomPptx({
        "_rels/.rels": ROOT_RELS,
        "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
          <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
            <p:sldSz cx="12192000" cy="6858000"/>
          </p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
          </Relationships>`,
        "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rIdExtImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://evil.example/tracker.png" TargetMode="External"/>
            <Relationship Id="rIdBombImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bomb.png"/>
            <Relationship Id="rIdJsLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
            <Relationship Id="rIdSafeLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:hi@example.com" TargetMode="External"/>
          </Relationships>`,
        "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
          <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
            <p:cSld><p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
              <p:pic>
                <p:nvPicPr><p:cNvPr id="2" name="External"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                <p:blipFill><a:blip r:embed="rIdExtImg"/></p:blipFill>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm></p:spPr>
              </p:pic>
              <p:pic>
                <p:nvPicPr><p:cNvPr id="3" name="PixelBomb"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                <p:blipFill><a:blip r:embed="rIdBombImg"/></p:blipFill>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm></p:spPr>
              </p:pic>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="4" name="Links"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="500000"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr/><a:p>
                  <a:r><a:rPr><a:hlinkClick r:id="rIdJsLink"/></a:rPr><a:t>Bad</a:t></a:r>
                  <a:r><a:rPr><a:hlinkClick r:id="rIdSafeLink"/></a:rPr><a:t>Good</a:t></a:r>
                </a:p></p:txBody>
              </p:sp>
            </p:spTree></p:cSld>
          </p:sld>`,
        "ppt/media/bomb.png": makeFakePngHeader(50_000, 50_000),
      });

      const parsed = await parsePptx(evil, { xmlParser });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(parsed.images).toHaveLength(0);
      expect(parsed.deck.slides[0].elements.filter((e) => e.type === "image")).toHaveLength(0);
      expect(parsed.report.slides[0].issues).toEqual(expect.arrayContaining([
        { kind: "externalImage", count: 1, previewCount: 0 },
        { kind: "oversizedImage", count: 1, previewCount: 0 },
      ]));

      const textEl = parsed.deck.slides[0].elements[0] as TextElement;
      const para = textEl.doc.content[0];
      expect(para.type).toBe("paragraph");
      const runs = para.type === "paragraph" ? para.content ?? [] : [];
      const badRun = runs[0];
      const goodRun = runs[1];
      expect(badRun?.type === "text" && badRun.marks).toBeUndefined();
      expect(goodRun?.type === "text" && goodRun.marks).toContainEqual({ type: "link", attrs: { href: "mailto:hi@example.com" } });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("deduplicates images across slides and cleans up uploaded files on mid-way failure without creating a page", async () => {
    const deckBytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
          <Relationship Id="rIdImg2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/>
        </Relationships>`,
      "ppt/slides/_rels/slide2.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
        </Relationships>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:pic><p:nvPicPr><p:cNvPr id="2" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
            <p:pic><p:nvPicPr><p:cNvPr id="3" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg2"/></p:blipFill><p:spPr><a:xfrm><a:off x="635000" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sld>`,
      "ppt/slides/slide2.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:pic><p:nvPicPr><p:cNvPr id="2" name="Logo2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sld>`,
      "ppt/media/logo.png": TINY_PNG_BYTES,
      "ppt/media/photo.png": TINY_PNG_BYTES,
    });

    const key1 = "note-files/user1/11111111-1111-4111-8111-111111111111.png";
    const key2 = "note-files/user1/22222222-2222-4222-8222-222222222222.png";

    // (a) 成功時：logo.png は 2 枚で使われても 1 回しかアップロードせず、建页は 1 回だけ。
    const uploads: string[] = [];
    const cleaned: string[][] = [];
    let createdPayload: { data: Deck } | null = null;
    const result = await importPptxFile(makeFileFromBytes(deckBytes, "demo.pptx"), {
      xmlParser,
      uploadFile: async (_blob, name) => {
        uploads.push(name);
        const key = uploads.length === 1 ? key1 : key2;
        return { url: noteFileUrl(key, name) };
      },
      cleanupFiles: async (keys) => { cleaned.push(keys); },
      createPage: async (body) => {
        createdPayload = { data: body.data };
        return fakePageSummary("page-1", body.title);
      },
    });
    expect(uploads).toEqual(["logo.png", "photo.png"]);
    expect(cleaned).toHaveLength(0);
    expect(result.page.id).toBe("page-1");
    expect(result.report.uploadedImageCount).toBe(2);
    const s1Logo = createdPayload!.data.slides[0].elements[0] as ImageElement;
    const s2Logo = createdPayload!.data.slides[1].elements[0] as ImageElement;
    expect(s1Logo.src).toBe(s2Logo.src);

    // (b) 2 枚目のアップロードで storage_limit が起きたら、1 枚目を片付けて建页しない。
    const cleanedOnFail: string[][] = [];
    const createSpy = vi.fn();
    let call = 0;
    await expect(importPptxFile(makeFileFromBytes(deckBytes, "demo.pptx"), {
      xmlParser,
      uploadFile: async (_blob, name) => {
        call += 1;
        if (call === 2) throw new StorageLimitError("Full", "member", 100, 100);
        return { url: noteFileUrl(key1, name) };
      },
      cleanupFiles: async (keys) => { cleanedOnFail.push(keys); },
      createPage: createSpy,
    })).rejects.toBeInstanceOf(StorageLimitError);
    expect(createSpy).not.toHaveBeenCalled();
    expect(cleanedOnFail).toEqual([[key1]]);
  });

  it("rejects decks whose final CanvasData exceeds 2 MiB and cleans up uploaded files", async () => {
    // 140 枚 × 約 18 KB のノート文字列 ≒ 2.5 MiB（200 枚上限は通り、2 MiB の最終本体上限で止まる）。
    const bigNote = "A".repeat(18_000);
    const parts: Record<string, string | Uint8Array> = {
      "_rels/.rels": ROOT_RELS,
      "ppt/media/logo.png": TINY_PNG_BYTES,
    };
    const sldIds: string[] = [];
    const presRels: string[] = [];
    for (let i = 1; i <= 130; i += 1) {
      sldIds.push(`<p:sldId id="${255 + i}" r:id="rId${i}"/>`);
      presRels.push(`<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`);
      parts[`ppt/slides/_rels/slide${i}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i}.xml"/>
        ${i === 1 ? `<Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>` : ""}
      </Relationships>`;
      parts[`ppt/slides/slide${i}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${i === 1 ? `<p:pic><p:nvPicPr><p:cNvPr id="2" name="L"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdI"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>` : ""}</p:spTree></p:cSld></p:sld>`;
      parts[`ppt/notesSlides/notesSlide${i}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="N"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${bigNote}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    }
    parts["ppt/presentation.xml"] = `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${sldIds.join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;
    parts["ppt/_rels/presentation.xml.rels"] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`;

    const bytes = await buildCustomPptx(parts);
    const key1 = "note-files/user1/33333333-3333-4333-8333-333333333333.png";
    const cleaned: string[][] = [];
    const createSpy = vi.fn();
    await expect(importPptxFile(makeFileFromBytes(bytes, "oversize-json.pptx"), {
      xmlParser,
      uploadFile: async () => ({ url: noteFileUrl(key1, "logo.png") }),
      cleanupFiles: async (keys) => { cleaned.push(keys); },
      createPage: createSpy,
    })).rejects.toSatisfy((err: unknown) => err instanceof PptxImportError && err.code === "deck_too_large");
    expect(createSpy).not.toHaveBeenCalled();
    expect(cleaned).toEqual([[key1]]);
  });

  it("falls back to presentation-level theme1.xml when slides have no slideMaster", async () => {
    const bytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
        </Relationships>`,
      "ppt/theme/theme1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:themeElements>
            <a:clrScheme name="Custom">
              <a:dk1><a:srgbClr val="111111"/></a:dk1>
              <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
              <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
              <a:accent2><a:srgbClr val="10B981"/></a:accent2>
            </a:clrScheme>
            <a:fontScheme name="Custom">
              <a:majorFont><a:latin typeface="Inter"/></a:majorFont>
              <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
            </a:fontScheme>
          </a:themeElements>
        </a:theme>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4500000" cy="1400000"/></a:xfrm>
                <a:prstGeom prst="roundRect"/>
                <a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
              </p:spPr>
              <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2400"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>Themed</a:t></a:r></a:p></p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>`,
    });
    const parsed = await parsePptx(bytes, { fileName: "pres-theme.pptx", xmlParser });
    const shape = parsed.deck.slides[0].elements.find((el) => el.type === "shape");
    expect(shape?.type).toBe("shape");
    if (shape?.type === "shape") {
      expect(shape.fill?.toLowerCase()).toBe("#10b981");
    }
  });

  it("resolves theme fillStyle/bgFillStyle modifiers directly, preserves opaque text/outline on transparent shapes, and preserves reflections", async () => {
    const shadedTheme = `<?xml version="1.0" encoding="UTF-8"?>
      <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Shaded">
        <a:themeElements>
          <a:clrScheme name="Shaded">
            <a:dk1><a:srgbClr val="111111"/></a:dk1>
            <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="222222"/></a:dk2>
            <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
            <a:accent1><a:srgbClr val="4080C0"/></a:accent1>
            <a:accent2><a:srgbClr val="2060A0"/></a:accent2>
            <a:accent3><a:srgbClr val="10B981"/></a:accent3>
            <a:accent4><a:srgbClr val="8B5CF6"/></a:accent4>
            <a:accent5><a:srgbClr val="0EA5E9"/></a:accent5>
            <a:accent6><a:srgbClr val="F59E0B"/></a:accent6>
            <a:hlink><a:srgbClr val="1D4ED8"/></a:hlink>
            <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
          </a:clrScheme>
          <a:fontScheme name="Clean">
            <a:majorFont><a:latin typeface="Inter"/></a:majorFont>
            <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
          </a:fontScheme>
          <a:fmtScheme name="Shaded">
            <a:fillStyleLst>
              <a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill>
            </a:fillStyleLst>
            <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
            <a:bgFillStyleLst>
              <a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>
            </a:bgFillStyleLst>
          </a:fmtScheme>
        </a:themeElements>
      </a:theme>`;

    const bytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/theme/theme1.xml": shadedTheme,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
          <Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/>
        </Relationships>`,
      "ppt/media/photo.png": TINY_PNG_BYTES,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:bg><p:bgRef idx="1001"><a:schemeClr val="accent1"/></p:bgRef></p:bg>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
              <!-- 1. fillRef idx=1 -> shaded 50% of accent1 (#4080C0 -> #204060) -->
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="roundRect"/></p:spPr>
                <p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:lnRef idx="0"/><a:fontRef idx="minor"/></p:style>
              </p:sp>
              <!-- 2. Transparent fill (alpha=0) with opaque text and border must stay visible (opacity undefined) -->
              <p:sp>
                <p:nvSpPr><p:cNvPr id="3" name="Outlined"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="700000"/><a:ext cx="2540000" cy="635000"/></a:xfrm>
                  <a:prstGeom prst="roundRect"/>
                  <a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill>
                  <a:ln w="25400"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>
                </p:spPr>
                <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:rPr><a:t>Visible label</a:t></a:r></a:p></p:txBody>
              </p:sp>
              <!-- 3. Horizontally flipped group containing text, rightArrow, and picture -->
              <p:grpSp>
                <p:nvGrpSpPr><p:cNvPr id="10" name="FlippedGroup"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
                <p:grpSpPr>
                  <a:xfrm flipH="1">
                    <a:off x="3000000" y="0"/><a:ext cx="3000000" cy="1500000"/>
                    <a:chOff x="0" y="0"/><a:chExt cx="3000000" cy="1500000"/>
                  </a:xfrm>
                </p:grpSpPr>
                <p:sp>
                  <p:nvSpPr><p:cNvPr id="11" name="UprightText"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
                  <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm></p:spPr>
                  <p:txBody><a:bodyPr/><a:p><a:r><a:t>Not upside down</a:t></a:r></a:p></p:txBody>
                </p:sp>
                <p:sp>
                  <p:nvSpPr><p:cNvPr id="12" name="Arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                  <p:spPr>
                    <a:xfrm><a:off x="0" y="600000"/><a:ext cx="1000000" cy="400000"/></a:xfrm>
                    <a:prstGeom prst="rightArrow"/>
                    <a:solidFill><a:srgbClr val="2563EB"/></a:solidFill>
                  </p:spPr>
                </p:sp>
                <p:pic>
                  <p:nvPicPr><p:cNvPr id="13" name="MirroredPhoto"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                  <p:blipFill><a:blip r:embed="rIdPic"/></p:blipFill>
                  <p:spPr><a:xfrm><a:off x="1200000" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr>
                </p:pic>
              </p:grpSp>
            </p:spTree>
          </p:cSld>
        </p:sld>`,
    });

    const parsed = await parsePptx(bytes, { xmlParser });
    const slide = parsed.deck.slides[0];
    // bgRef idx=1001 applies tint 50% to #4080C0 -> (#40*0.5+255*0.5=160=a0, #80*0.5+127.5=192=c0, #c0*0.5+127.5=224=e0)
    expect(slide.background).toBe("#a0c0e0");

    const shapes = slide.elements.filter((e): e is ShapeElement => e.type === "shape");
    const styled = shapes.find((s) => s.fill === "#204060");
    expect(styled).toBeDefined();

    const outlined = shapes.find((s) => richDocText(s.doc) === "Visible label")!;
    expect(outlined).toBeDefined();
    expect(outlined.fill).toBeNull();
    expect(outlined.stroke).toBe("#112233");
    expect(outlined.opacity).toBeUndefined();

    const uprightText = slide.elements.find((e): e is TextElement => e.type === "text" && richDocText(e.doc) === "Not upside down")!;
    expect(uprightText.rotation).toBe(0);

    const flippedArrow = shapes.find((s) => s.fill === "#2563eb")!;
    expect(flippedArrow.shape).toBe("arrowLeft");
    expect(flippedArrow.rotation).toBe(0);

    const mirroredImg = slide.elements.find((e): e is ImageElement => e.type === "image")!;
    expect(mirroredImg.rotation).toBe(0);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].flipH).toBe(true);
    expect(parsed.images[0].flipV).toBeUndefined();
  });

  it("reports a single oversized media entry as oversizedImage without rejecting the whole deck", async () => {
    const bigPng = new Uint8Array(4096);
    bigPng.set(TINY_PNG_BYTES, 0);
    const bytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdHuge" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/huge.png"/>
          <Relationship Id="rIdOk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ok.png"/>
        </Relationships>`,
      "ppt/media/huge.png": bigPng,
      "ppt/media/ok.png": TINY_PNG_BYTES,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:pic><p:nvPicPr><p:cNvPr id="2" name="Huge"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdHuge"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
            <p:pic><p:nvPicPr><p:cNvPr id="3" name="Ok"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdOk"/></p:blipFill><p:spPr><a:xfrm><a:off x="635000" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sld>`,
    });

    const parsed = await parsePptx(bytes, { xmlParser, maxMediaEntryBytes: 1024 });
    expect(parsed.deck.slides).toHaveLength(1);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].zipPath).toBe("ppt/media/ok.png");
    expect(parsed.report.slides[0].issues).toEqual([{ kind: "oversizedImage", count: 1, previewCount: 0 }]);
  });

  it("prioritizes slide elements over master decorations, reports elementLimit truncation, and prunes dropped images", async () => {
    const extraShapes = Array.from({ length: 1002 }, (_, i) => (
      `<p:sp><p:nvSpPr><p:cNvPr id="${10 + i}" name="S${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="63500" cy="63500"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>`
    )).join("");
    const bytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/theme/theme1.xml": DEFAULT_THEME_XML,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
          <Relationship Id="rIdBgPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/master-bg.png"/>
        </Relationships>`,
      "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:pic><p:nvPicPr><p:cNvPr id="2" name="MasterPic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdBgPic"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sldMaster>`,
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
        </Relationships>`,
      "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
        </p:sldLayout>`,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
          <Relationship Id="rIdTailPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/tail.png"/>
        </Relationships>`,
      "ppt/media/master-bg.png": TINY_PNG_BYTES,
      "ppt/media/tail.png": TINY_PNG_BYTES,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            ${extraShapes}
            <p:pic><p:nvPicPr><p:cNvPr id="5000" name="DroppedTailPic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdTailPic"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sld>`,
    });

    const parsed = await parsePptx(bytes, { xmlParser });
    expect(parsed.deck.slides[0].elements).toHaveLength(1000);
    // 全 1,000 件がスライド本体の図形で埋まり、落ちた母版装飾(1) + 超過スライド要素(3) = 4 件が報告される。
    expect(parsed.deck.slides[0].elements.every((e) => e.type === "shape")).toBe(true);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.report.uploadedImageCount).toBe(0);
    expect(parsed.report.slides[0].issues).toEqual([{ kind: "elementLimit", count: 4, previewCount: 0 }]);
  });

  it("cleans up an in-flight upload on cancel and keeps final page creation non-cancelable", async () => {
    const deckBytes = await buildCustomPptx({
      "_rels/.rels": ROOT_RELS,
      "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/one.png"/>
          <Relationship Id="rIdImg2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/two.png"/>
        </Relationships>`,
      "ppt/media/one.png": TINY_PNG_BYTES,
      "ppt/media/two.png": TINY_PNG_BYTES,
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
            <p:pic><p:nvPicPr><p:cNvPr id="2" name="One"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
            <p:pic><p:nvPicPr><p:cNvPr id="3" name="Two"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg2"/></p:blipFill><p:spPr><a:xfrm><a:off x="635000" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm></p:spPr></p:pic>
          </p:spTree></p:cSld>
        </p:sld>`,
    });

    const key1 = "note-files/user1/44444444-4444-4444-8444-444444444444.png";
    const key2 = "note-files/user1/55555555-5555-4555-8555-555555555555.png";

    // (a) 1 枚目のアップロード中に abort されても、1 枚目の応答の鍵を記録してから片付け、2 枚目は送らない。
    const cancelDuringUpload = new AbortController();
    const cleanedKeys: string[][] = [];
    let uploadCalls = 0;
    const createSpy = vi.fn();
    await expect(importPptxFile(makeFileFromBytes(deckBytes, "cancel.pptx"), {
      xmlParser,
      signal: cancelDuringUpload.signal,
      uploadFile: async (_blob, name, _mime, sig) => {
        expect(sig).toBeUndefined();
        uploadCalls += 1;
        cancelDuringUpload.abort();
        return { url: noteFileUrl(uploadCalls === 1 ? key1 : key2, name) };
      },
      cleanupFiles: async (keys) => { cleanedKeys.push(keys); },
      createPage: createSpy,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(uploadCalls).toBe(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(cleanedKeys).toEqual([[key1]]);

    // (b) saving 段階に入ったあとの abort は建页を止めず、作成されたページをそのまま返す。
    const abortDuringSave = new AbortController();
    let idx = 0;
    const saved = await importPptxFile(makeFileFromBytes(deckBytes, "commit.pptx"), {
      xmlParser,
      signal: abortDuringSave.signal,
      uploadFile: async (_blob, name) => {
        idx += 1;
        return { url: noteFileUrl(idx === 1 ? key1 : key2, name) };
      },
      createPage: async (body, sig) => {
        expect(sig).toBeUndefined();
        abortDuringSave.abort();
        return fakePageSummary("page-committed", body.title);
      },
    });
    expect(saved.page.id).toBe("page-committed");
  });
});
