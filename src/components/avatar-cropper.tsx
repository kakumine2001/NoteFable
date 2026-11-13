"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

// 写真を丸く切り抜く画面（多くのサービスと同じ: ドラッグで位置、スライダーで拡大、保存で正方形に書き出す）。
const VIEW = 200; // 画面に出す円の直径（CSS px）
// 主流のサービスに合わせる: 保存する正方形は 512px（Slack の最小値。LinkedIn は 400〜640、X は 400、Google は 720）。
export const AVATAR_OUTPUT = 512;
// 短い辺がこれより小さい写真は断る（X の最小値と同じ。小さい写真を引き伸ばすとぼやけるため）。
export const AVATAR_MIN_SIDE = 200;
const MAX_ZOOM = 3;

type Point = { x: number; y: number };
type Layout = { dx: number; dy: number; w: number; h: number };

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// 写真を円いっぱいに敷き（短い辺が円に合う大きさ × zoom）、円の外に隙間が出ない範囲でずらす。
function layoutFor(size: Point, zoom: number, offset: Point, view: number): Layout & { offset: Point } {
  const scale = Math.max(view / size.x, view / size.y) * zoom;
  const w = size.x * scale;
  const h = size.y * scale;
  const next = { x: clamp(offset.x, (w - view) / 2), y: clamp(offset.y, (h - view) / 2) };
  return { dx: (view - w) / 2 + next.x, dy: (view - h) / 2 + next.y, w, h, offset: next };
}

type AvatarCropperProps = {
  file: File;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (photo: Blob) => void;
};

export function AvatarCropper({ file, saving, error, onCancel, onSave }: AvatarCropperProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ start: Point; origin: Point } | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  // 写真を読み込む（スマホの写真の向きの情報も反映する）。
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((image) => {
        if (cancelled) {
          image.close();
        } else if (Math.min(image.width, image.height) < AVATAR_MIN_SIDE) {
          image.close();
          setLoadError(msg("That photo is too small. Choose one that is at least {size} × {size} pixels."));
        } else {
          setBitmap(image);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(msg("Could not read that image. Try another photo."));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => () => bitmap?.close(), [bitmap]);

  const size = bitmap ? { x: bitmap.width, y: bitmap.height } : null;
  const layout = size ? layoutFor(size, zoom, offset, VIEW) : null;

  // 円の中に今の切り抜きを描く（高解像度の画面でもぼやけないよう 2 倍で描く）。
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !bitmap || !layout) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.drawImage(bitmap, layout.dx, layout.dy, layout.w, layout.h);
  });

  function move(next: Point) {
    if (size) setOffset(layoutFor(size, zoom, next, VIEW).offset);
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    // 指が円の外へ出てもドラッグを続けられるようにする（取れない環境でもドラッグ自体は動く）。
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕まえられなくても続行する */ }
    drag.current = { start: { x: event.clientX, y: event.clientY }, origin: layout?.offset ?? offset };
  }
  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (!current) return;
    move({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y });
  }
  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const step = 12;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    move({ x: (layout?.offset.x ?? 0) + delta[0], y: (layout?.offset.y ?? 0) + delta[1] });
  }

  function changeZoom(value: number) {
    setZoom(value);
    if (size) setOffset(layoutFor(size, value, offset, VIEW).offset);
  }

  // 正方形に書き出す。WebP に書き出せない環境（古い Safari など）は自動で PNG になり、サーバーは中身で種類を見分ける。
  function save() {
    if (!bitmap || !layout) return;
    const out = document.createElement("canvas");
    out.width = AVATAR_OUTPUT;
    out.height = AVATAR_OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const ratio = AVATAR_OUTPUT / VIEW;
    ctx.drawImage(bitmap, layout.dx * ratio, layout.dy * ratio, layout.w * ratio, layout.h * ratio);
    out.toBlob((blob) => { if (blob) onSave(blob); }, "image/webp", 0.9);
  }

  return (
    <div className="avatar-cropper">
      <div className="avatar-crop-view" style={{ width: VIEW, height: VIEW }}>
        <canvas ref={canvasRef} width={VIEW * 2} height={VIEW * 2} style={{ width: VIEW, height: VIEW }}
          tabIndex={0} role="img" aria-label={t("Photo preview. Drag or use the arrow keys to move it.")}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKeyDown} />
      </div>
      <label className="avatar-zoom">
        <span>{t("Zoom")}</span>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!bitmap}
          onChange={(event) => changeZoom(Number(event.target.value))} />
      </label>
      <p className="avatar-crop-hint">{t("Drag the photo to reposition it.")}</p>
      {(loadError || error) && <p className="profile-error" role="alert">{loadError ? t(loadError, { size: AVATAR_MIN_SIDE }) : error}</p>}
      <div className="avatar-crop-actions">
        <button type="button" onClick={onCancel} disabled={saving}>{t("Cancel")}</button>
        <button type="button" className="is-primary" onClick={save} disabled={!bitmap || saving}>{saving ? t("Saving…") : t("Save")}</button>
      </div>
    </div>
  );
}
