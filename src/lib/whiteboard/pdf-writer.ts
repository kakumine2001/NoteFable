// ホワイトボードの PDF 書き出し用の、画像だけのページを並べる小さな PDF 書き出し（依存なし）。
// 1 ページに 1 枚の画像（枠ごと、または全体を描いたもの）を、ページいっぱいに置く。
// 画像は可逆の Flate（RGB の生データを deflate したもの）か JPEG（DCT）。

export type PdfImage =
  | { kind: "flate"; data: Uint8Array; pixelWidth: number; pixelHeight: number }
  | { kind: "jpeg"; data: Uint8Array; pixelWidth: number; pixelHeight: number };

// width・height はページの大きさ（ポイント、1/72 インチ）。
export type PdfPage = { width: number; height: number; image: PdfImage };

// PDF のページの一辺の上限（ポイント）。
export const MAX_PDF_PAGE_POINTS = 14_400;

const encoder = new TextEncoder();

// PDF の文字列リテラルに入れる文字（( ) \ を退避し、ASCII 以外は UTF-16BE の 16 進にする）。
export function pdfText(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return `(${value.replace(/[()\\]/g, (char) => `\\${char}`)})`;
  let hex = "FEFF";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code > 0xffff) {
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      hex += high.toString(16).padStart(4, "0") + low.toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}

const number = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

// ページの大きさを PDF の上限に収める（縦横比はそのまま）。
export function fitPageSize(width: number, height: number) {
  const scale = Math.min(1, MAX_PDF_PAGE_POINTS / Math.max(width, height, 1));
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
}

export function buildPdf(pages: readonly PdfPage[], { title }: { title?: string } = {}): Uint8Array {
  if (!pages.length) throw new Error("A PDF needs at least one page.");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  // オブジェクトの番号：1 カタログ、2 ページの木、3 情報、以降ページごとに（ページ・内容・画像）の 3 つ。
  const pageId = (index: number) => 4 + index * 3;
  const begin = (id: number) => { offsets[id] = length; push(`${id} 0 obj\n`); };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  begin(2);
  push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  begin(3);
  push(`<< /Producer (NoteFable)${title ? ` /Title ${pdfText(title)}` : ""} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const { width, height } = fitPageSize(page.width, page.height);
    const id = pageId(index);
    const content = `q ${number(width)} 0 0 ${number(height)} 0 0 cm /Im0 Do Q\n`;
    begin(id);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(width)} ${number(height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`);
    begin(id + 1);
    push(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream\nendobj\n`);
    begin(id + 2);
    const { image } = page;
    const filter = image.kind === "jpeg" ? "/DCTDecode" : "/FlateDecode";
    push(`<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${image.data.byteLength} >>\nstream\n`);
    push(image.data);
    push("\nendstream\nendobj\n");
  });

  const count = pageId(pages.length);
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

// 白の上に合成した RGB が、すべて画布の色（既定は白）か（何も描かれていないページ）。
export function isBlankRgb(rgb: Uint8Array, background: readonly [number, number, number] = [255, 255, 255]): boolean {
  const [red, green, blue] = background;
  for (let index = 0; index + 2 < rgb.length; index += 3) {
    if (rgb[index] !== red || rgb[index + 1] !== green || rgb[index + 2] !== blue) return false;
  }
  return true;
}

// RGBA の画素から、白の上に合成した RGB を作る（PDF の画像は透明を持たない）。
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixels = rgba.length / 4;
  const out = new Uint8Array(pixels * 3);
  for (let index = 0; index < pixels; index++) {
    const alpha = rgba[index * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      out[index * 3 + channel] = Math.round(rgba[index * 4 + channel] * alpha + 255 * (1 - alpha));
    }
  }
  return out;
}
