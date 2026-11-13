"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { type ReasoningEffort } from "@/lib/models";
import { useModels } from "@/components/models-provider";
import { reasoningDescriptions, reasoningLabels } from "@/lib/reasoning-labels";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";
import { useT } from "@/components/i18n-provider";

// スマホ用のモデル・推論強度の選択。小さなピルから開く 2 段の小窓ではなく、画面下から出るシートにして、
// 行を大きくし、推論強度はドラッグ式のスライダーではなく 1 回押すだけのボタンにする。
export function ModelSheetSelect({
  value,
  reasoning,
  onModelChange,
  onReasoningChange,
}: {
  value: string;
  reasoning: string;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { options: modelOptions, getModelOption } = useModels();
  const model = getModelOption(value);
  const efforts = model.reasoningEfforts;
  const current = efforts.includes(reasoning as ReasoningEffort) ? reasoning : model.defaultReasoning;

  function close() {
    setOpen(false);
  }
  useBackToClose(open, close);
  const { attach, bind } = useSwipeDismiss<HTMLDivElement>({ axis: "y", direction: 1, onDismiss: close, focusOnAttach: true });


  function openSheet() {
    // 画面キーボードが出ていると、シートがキーボードの上に浮いてしまう。先に閉じる。
    (document.activeElement as HTMLElement | null)?.blur();
    setOpen(true);
  }

  return (
    <div className="min-w-0 shrink-0" data-testid="model-select">
      <button
        type="button"
        className="codex-model-trigger model-sheet-trigger"
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("Model: {label}, reasoning: {v1}", { label: model.label, v1: t(reasoningLabels[current] ?? current) })}
      >
        <span className="truncate">{model.label}</span>
        <span className="model-sheet-trigger-effort">{t(reasoningLabels[current] ?? current)}</span>
        <ChevronDown size={16} />
      </button>

      {open &&
        createPortal(
          <div className="model-sheet-root">
            <button type="button" className="model-sheet-backdrop" aria-label={t("Close")} onClick={close} />
            <div className="model-sheet" role="dialog" aria-modal="true" aria-label={t("Model and reasoning")} tabIndex={-1}
              ref={attach}>
              <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>

              <h2 className="model-sheet-title">{t("Model")}</h2>
              <div className="model-sheet-list" role="radiogroup" aria-label={t("Model")}>
                {modelOptions.map((item) => {
                  const selected = item.id === value;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`model-sheet-row ${selected ? "is-selected" : ""}`}
                      onClick={() => onModelChange(item.id)}
                    >
                      <span>{item.label}</span>
                      {selected && <Check size={20} />}
                    </button>
                  );
                })}
              </div>

              {efforts.length > 1 && (
                <>
                  <h2 className="model-sheet-title">{t("Reasoning")}</h2>
                  <div className="model-sheet-efforts" role="radiogroup" aria-label={t("Reasoning effort")}>
                    {efforts.map((effort) => (
                      <button
                        key={effort}
                        type="button"
                        role="radio"
                        aria-checked={effort === current}
                        className="model-sheet-effort"
                        onClick={() => onReasoningChange(effort)}
                      >
                        {t(reasoningLabels[effort] ?? effort)}
                      </button>
                    ))}
                  </div>
                  <p className="model-sheet-hint">{t(reasoningDescriptions[current])}</p>
                </>
              )}

              <button type="button" className="model-sheet-done" onClick={close}>
                {t("Done")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
