"use client";

import { Check } from "lucide-react";
import { useCallback, useId, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { isColorRef, type ColorRef } from "@/lib/slides/model";
import { FIXED_COLORS, PALETTE_TOKENS, resolveColor, type ResolvedTheme } from "@/lib/slides/themes";

// スライドのエディターの小さなメニュー（ボタン + 浮かぶメニュー）。中身は close を受け取って描く。
export function MenuButton({ label, icon, text, className = "", disabled = false, menuClassName = "", children }: {
  label: string; icon?: ReactNode; text?: ReactNode; className?: string; disabled?: boolean; menuClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  return <>
    <button type="button" className={`slides-tool ${className}${menu ? " is-active" : ""}`} disabled={disabled} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={!!menu} aria-controls={id}
      onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false })}>
      {icon}{text}
    </button>
    {menu && <AnswerMenu id={id} label={label} className={`slides-menu ${menuClassName}`} anchor={menu.anchor} trigger={menu.trigger} focusLast={false} onClose={close}>
      {children(close)}
    </AnswerMenu>}
  </>;
}

// 右クリックなど、位置を指定して開くメニュー。
export function PointMenu({ x, y, label, onClose, children }: { x: number; y: number; label: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const [trigger] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLButtonElement | null) ?? document.body as unknown as HTMLButtonElement : null));
  if (!trigger) return null;
  return <AnswerMenu id={id} label={label} className="slides-menu" anchor={new DOMRect(x, y, 0, 0)} trigger={trigger} focusLast={false} onClose={onClose}>{children}</AnswerMenu>;
}

export function MenuItem({ icon, label, shortcut, onClick, disabled = false, checked, danger = false }: {
  icon?: ReactNode; label: string; shortcut?: string; onClick: () => void; disabled?: boolean; checked?: boolean; danger?: boolean;
}) {
  return <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} aria-disabled={disabled || undefined}
    className={`chat-menu-item slides-menu-item${danger ? " is-danger" : ""}`} onClick={() => { if (!disabled) onClick(); }}>
    {icon}<span className="flex-1">{label}</span>
    {checked && <Check size={15} aria-hidden="true" />}
    {shortcut && <kbd className="slides-menu-shortcut">{shortcut}</kbd>}
  </button>;
}

// 色を選ぶ：主題の色（主題を替えると一緒に替わる）・よく使う色・自由な色。none を許すときは「なし」。
export function ColorPicker({ value, theme, onChange, allowNone = false }: { value: ColorRef | null; theme: ResolvedTheme; onChange: (value: ColorRef | null) => void; allowNone?: boolean }) {
  const t = useT();
  const custom = value && value.startsWith("#") ? value : resolveColor(value, theme);
  return <div className="slides-colors">
    <div className="slides-colors-label">{t("Theme colors")}</div>
    <div className="slides-colors-grid">
      {PALETTE_TOKENS.map((token) => <button key={token} type="button" role="menuitemradio" aria-checked={value === token} title={t(TOKEN_LABELS[token])} aria-label={t(TOKEN_LABELS[token])}
        className="slides-swatch" style={{ background: theme.palette[token] }} onClick={() => onChange(token)} />)}
    </div>
    <div className="slides-colors-label">{t("Colors")}</div>
    <div className="slides-colors-grid">
      {FIXED_COLORS.map((color) => <button key={color} type="button" role="menuitemradio" aria-checked={value === color} title={color} aria-label={color}
        className="slides-swatch" style={{ background: color }} onClick={() => onChange(color)} />)}
    </div>
    <div className="slides-colors-row">
      <label className="slides-color-custom">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(custom) ? custom : "#000000"} onChange={(event) => { if (isColorRef(event.target.value)) onChange(event.target.value as ColorRef); }} />
        <span>{t("Custom")}</span>
      </label>
      {allowNone && <button type="button" role="menuitemradio" aria-checked={value === null} className="slides-color-none" onClick={() => onChange(null)}>{t("No color")}</button>}
    </div>
  </div>;
}

export const TOKEN_LABELS: Record<string, string> = {
  text: msg("Text"), heading: msg("Heading"), muted: msg("Muted"), accent: msg("Accent"), accent2: msg("Accent 2"), accent3: msg("Accent 3"),
  surface: msg("Surface"), background: msg("Background"), line: msg("Line"),
};
