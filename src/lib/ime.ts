// IME（日本語・中国語などの変換）の途中のキーか。変換の確定・取り消しの Enter / Esc を、送信や閉じる操作と取り違えないために使う。
// Safari は変換を確定した直後の keydown で isComposing を false にするが、keyCode は 229 のままなので両方を見る。
export function isImeKeyEvent(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}
