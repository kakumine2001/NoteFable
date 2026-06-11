"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getModelOption, MODEL_OPTIONS } from "@/lib/models";

// 推論強度の短い表示名。ボタン内とメニュー内で共通利用する。
const reasoningLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

// 各推論強度の補足説明。選択時の判断材料としてメニューに表示する。
const reasoningDescriptions: Record<string, string> = {
  low: "Light reasoning",
  medium: "Balanced for most tasks",
  high: "Better for complex work",
  xhigh: "Maximum reasoning depth",
};

// 各モデルの簡単な用途説明。MODEL_OPTIONS には UI 文言を増やしすぎないためここで分ける。
const modelDescriptions: Record<string, string> = {
  "gpt-5.5": "OpenAI general reasoning",
  "deepseek-v4-flash": "DeepSeek fast model",
  "deepseek-v4-pro": "DeepSeek strongest model",
};

export function ReasoningSelect({
  value,
  options,
  xhighLabel = "XHigh",
  onChange,
}: {
  // 現在選択されている推論強度。
  value: string;
  // 選択中モデルで利用できる推論強度だけが渡される。
  options: readonly string[];
  // DeepSeek では xhigh を Max と表示するための差し替えラベル。
  xhighLabel?: string;
  // 選択変更時に親コンポーネントの reasoning state を更新する。
  onChange: (value: string) => void;
}) {
  // メニューの開閉状態。
  const [open, setOpen] = useState(false);
  // 外側クリック判定の基準になるメニュー全体の DOM。
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // メニューが開いている間だけ document にクリック監視を付ける。
    // 外側クリックで閉じられるようにしつつ、閉じている間は不要なグローバルリスナーを持たない。
    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", closeOnOutsideClick);
    }

    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium text-slate-900 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] sm:h-10 sm:gap-1 sm:px-3 sm:text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{value === "xhigh" ? xhighLabel : reasoningLabels[value]}</span>
        <ChevronDown
          className={`text-slate-700 transition-transform duration-150 ease-out ${
            open ? "rotate-180" : ""
          }`}
          size={15}
        />
      </button>

      {open && (
        <div
          className="motion-menu fixed bottom-28 left-1/2 z-30 w-64 -translate-x-1/2 overflow-hidden rounded-2xl bg-white py-1 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 sm:absolute sm:bottom-full sm:left-auto sm:right-0 sm:mb-3 sm:w-80 sm:translate-x-0 sm:rounded-[1.35rem] sm:py-2"
          role="menu"
        >
          <div className="space-y-0.5 p-1.5 sm:space-y-1 sm:p-2">
            {options.map((item) => {
              // 今描画している選択肢が現在値かどうか。背景色とチェックアイコンに使う。
              const selected = item === value;

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] sm:gap-3 sm:rounded-2xl sm:px-3 sm:py-3 ${
                    selected ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
                  }`}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-slate-950">
                    {selected ? <Check size={16} strokeWidth={2.3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-950 sm:text-sm">
                      {item === "xhigh" ? xhighLabel : reasoningLabels[item]}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-slate-500 sm:text-sm sm:leading-5">
                      {reasoningDescriptions[item]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelSelect({
  value,
  onChange,
}: {
  // 現在選択されているモデル ID。
  value: string;
  // 選択変更時に親コンポーネントの model state を更新する。
  onChange: (value: string) => void;
}) {
  // モデルメニューの開閉状態。
  const [open, setOpen] = useState(false);
  // 外側クリックで閉じるためにメニュー全体を参照する。
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 現在のモデル ID から表示名や対応機能を引いた設定。
  const currentModel = getModelOption(value);

  useEffect(() => {
    // モデル選択も Reasoning と同じ外側クリック挙動にする。
    // 入力フォーム内に複数の小さなメニューがあるため、閉じ方を揃えて操作の迷いを減らす。
    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", closeOnOutsideClick);
    }

    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 max-w-32 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium text-slate-900 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] sm:h-10 sm:max-w-none sm:gap-1 sm:px-3 sm:text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{currentModel.label}</span>
        <ChevronDown
          className={`shrink-0 text-slate-700 transition-transform duration-150 ease-out ${
            open ? "rotate-180" : ""
          }`}
          size={15}
        />
      </button>

      {open && (
        <div
          className="motion-menu fixed bottom-28 left-1/2 z-30 w-64 -translate-x-1/2 overflow-hidden rounded-2xl bg-white py-1 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 sm:absolute sm:bottom-full sm:left-0 sm:mb-3 sm:w-80 sm:translate-x-0 sm:rounded-[1.35rem] sm:py-2"
          role="menu"
        >
          <div className="space-y-0.5 p-1.5 sm:space-y-1 sm:p-2">
            {MODEL_OPTIONS.map((item) => {
              // 現在選択中のモデルかどうか。選択済み表示に使う。
              const selected = item.id === value;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] sm:gap-3 sm:rounded-2xl sm:px-3 sm:py-3 ${
                    selected ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
                  }`}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-slate-950">
                    {selected ? <Check size={16} strokeWidth={2.3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-950 sm:text-sm">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-slate-500 sm:text-sm sm:leading-5">
                      {modelDescriptions[item.id]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
