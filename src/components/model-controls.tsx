"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getModelOption, MODEL_OPTIONS } from "@/lib/models";

// 推論強度の短い表示名。ボタン内とメニュー内で共通利用する。
const reasoningLabels: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

// 各推論強度の補足説明。選択時の判断材料としてメニューに表示する。
const reasoningDescriptions: Record<string, string> = {
  none: "No reasoning",
  low: "Light reasoning",
  medium: "Balanced for most tasks",
  high: "Better for complex work",
  xhigh: "Very deep reasoning",
  max: "Maximum reasoning depth",
};

// 各モデルの簡単な用途説明。MODEL_OPTIONS には UI 文言を増やしすぎないためここで分ける。
const modelDescriptions: Record<string, string> = {
  "gpt-5.6-sol": "OpenAI flagship reasoning",
  "deepseek-v4-flash": "DeepSeek fast model",
  "deepseek-v4-pro": "DeepSeek strongest model",
};

function formatReasoningLabel(value: string, provider: string) {
  // DeepSeek では最上位の推論強度を短く Max と表示する。
  if (provider === "deepseek" && value === "xhigh") {
    return "Max";
  }

  return reasoningLabels[value] ?? value;
}

export function ModelSelect({
  value,
  reasoning,
  onModelChange,
  onReasoningChange,
}: {
  // 現在選択されているモデル ID。
  value: string;
  // 現在選択されている推論強度。
  reasoning: string;
  // 選択変更時に親コンポーネントの model state を更新する。
  onModelChange: (value: string) => void;
  // 選択変更時に親コンポーネントの reasoning state を更新する。
  onReasoningChange: (value: string) => void;
}) {
  // モデルメニューの開閉状態。
  const [open, setOpen] = useState(false);
  // 外側クリックで閉じるためにメニュー全体を参照する。
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 現在のモデル ID から表示名や対応機能を引いた設定。
  const currentModel = getModelOption(value);
  const currentReasoningLabel = formatReasoningLabel(reasoning, currentModel.provider);

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
        className="flex h-9 max-w-44 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-slate-900 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] sm:h-10 sm:max-w-none sm:px-3 sm:text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{currentModel.label}</span>
        <span className="hidden text-slate-400 sm:inline">/</span>
        <span className="shrink-0 text-slate-600">{currentReasoningLabel}</span>
        <ChevronDown
          className={`shrink-0 text-slate-700 transition-transform duration-150 ease-out ${
            open ? "rotate-180" : ""
          }`}
          size={15}
        />
      </button>

      {open && (
        <div
          className="motion-menu fixed bottom-28 left-1/2 z-30 w-72 -translate-x-1/2 overflow-hidden rounded-2xl bg-white py-1 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 sm:absolute sm:bottom-full sm:left-0 sm:mb-3 sm:w-96 sm:translate-x-0 sm:rounded-[1.35rem] sm:py-2"
          role="menu"
        >
          <div className="space-y-0.5 p-1.5 sm:space-y-1 sm:p-2">
            {MODEL_OPTIONS.map((item) => {
              // 現在選択中のモデルかどうか。選択済み表示に使う。
              const selected = item.id === value;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl transition-[background-color] duration-150 ease-out sm:rounded-2xl ${
                    selected ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onModelChange(item.id)}
                    className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-[transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] sm:gap-3 sm:rounded-2xl sm:px-3 sm:py-3"
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

                  {selected && (
                    <div className="grid gap-1 px-2.5 pb-2 sm:px-3 sm:pb-3" role="group" aria-label="Reasoning effort">
                      <div className="grid grid-cols-2 gap-1">
                        {item.reasoningEfforts.map((effort) => {
                          const reasoningSelected = effort === reasoning;

                          return (
                            <button
                              key={effort}
                              type="button"
                              onClick={() => {
                                onReasoningChange(effort);
                                setOpen(false);
                              }}
                              className={`rounded-lg px-2 py-1.5 text-left transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] ${
                                reasoningSelected
                                  ? "bg-white text-slate-950 shadow-sm"
                                  : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                              }`}
                            >
                              <span className="block text-xs font-semibold">
                                {formatReasoningLabel(effort, item.provider)}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                                {reasoningDescriptions[effort]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
