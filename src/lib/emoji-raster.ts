// 絵文字を画像にして、実際に描かれた範囲（インク）を枠の中央に置く。
// 文字のまま置くと、絵文字フォントの字送りや上下の余白が OS ごとに違い（iOS は小さい字で特にずれる）、枠の中央に来ない。

// 描く字の大きさと、はみ出しを見込んだキャンバスの一辺（px）。
const FONT_SIZE = 96;
const CANVAS_SIZE = 192;
// 出来上がる画像の一辺（px）。表示は最大でも 30px ほどなので、高精細の画面でも足りる。
const OUTPUT_SIZE = 96;
// 枠の一辺に対する字の大きさ。文字のまま出すとき（.app-icon-emoji）と同じ比にして、絵文字ごとの大小を保つ。
const GLYPH_RATIO = 0.9;
// これより薄い画素は描かれていないものとして扱う（縁のにじみを範囲に入れない）。
const ALPHA_THRESHOLD = 16;
const EMOJI_FONT = `${FONT_SIZE}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

export type InkBounds = { left: number; top: number; width: number; height: number };

// 色の付いた画素が 1 つでもあるか。無ければ、色絵文字のフォントが無く黒い字形で描かれている。
export function hasColor(data: ArrayLike<number>) {
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] >= ALPHA_THRESHOLD && (data[index] || data[index + 1] || data[index + 2])) return true;
  }
  return false;
}

// RGBA の画素から、描かれている範囲を求める。何も描かれていなければ null。
export function inkBounds(data: ArrayLike<number>, width: number, height: number): InkBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// インクを一辺 size の正方形の中央へ置くときの描画先。大きさは字の大きさ fontSize を枠の GLYPH_RATIO 倍に合わせ、
// それでもはみ出す絵文字だけ枠に収まるまで縮める。
export function fitCentered(bounds: InkBounds, size: number, fontSize: number) {
  const scale = Math.min((size * GLYPH_RATIO) / fontSize, size / Math.max(bounds.width, bounds.height));
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

const cache = new Map<string, string | null>();

// 絵文字を、インクを中央に置いた正方形の画像（data URL）にする。
// 作れないとき（サーバー側、canvas が使えない、指紋対策で画素が読めない）は null。呼び出し側は文字のまま出す。
export function emojiToImage(emoji: string): string | null {
  if (typeof document === "undefined") return null;
  const cached = cache.get(emoji);
  if (cached !== undefined) return cached;
  const image = rasterize(emoji);
  // 一時的な失敗（canvas が作れない、例外）は覚えず、次の描画でやり直す。
  if (image !== undefined) cache.set(emoji, image);
  return image ?? null;
}

// undefined は一時的な失敗、null はこの環境では画像にしない絵文字。
function rasterize(emoji: string): string | null | undefined {
  try {
    const source = document.createElement("canvas");
    source.width = source.height = CANVAS_SIZE;
    const context = source.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.font = EMOJI_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(emoji, CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    const { data } = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    // 黒一色の字形（色絵文字が無い環境）は、周りの文字色に合わせるため文字のまま出す。
    if (!hasColor(data)) return null;
    const bounds = inkBounds(data, CANVAS_SIZE, CANVAS_SIZE);
    // 端まで届いているのは、切れているか、指紋対策で雑音が混ざった画素。どちらも正しい範囲が分からない。
    if (!bounds || bounds.left === 0 || bounds.top === 0
      || bounds.left + bounds.width === CANVAS_SIZE || bounds.top + bounds.height === CANVAS_SIZE) return null;
    const output = document.createElement("canvas");
    output.width = output.height = OUTPUT_SIZE;
    const target = fitCentered(bounds, OUTPUT_SIZE, FONT_SIZE);
    const outputContext = output.getContext("2d");
    if (!outputContext) return undefined;
    outputContext.drawImage(source, bounds.left, bounds.top, bounds.width, bounds.height, target.x, target.y, target.width, target.height);
    return output.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
