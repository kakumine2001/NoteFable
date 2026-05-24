"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getModelOption, MODEL_OPTIONS } from "@/lib/models";

const reasoningLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

const reasoningDescriptions: Record<string, string> = {
  low: "Light reasoning",
  medium: "Balanced for most tasks",
  high: "Better for complex work",
  xhigh: "Maximum reasoning depth",
};

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
  value: string;
  options: readonly string[];
  xhighLabel?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
        className="flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-slate-900 hover:bg-[#e9e7e5]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{value === "xhigh" ? xhighLabel : reasoningLabels[value]}</span>
        <ChevronDown className="text-slate-700" size={15} />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 z-30 mb-3 w-80 overflow-hidden rounded-[1.35rem] bg-white py-2 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200"
          role="menu"
        >
          <div className="space-y-1 p-2">
            {options.map((item) => {
              const selected = item === value;

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left ${
                    selected ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
                  }`}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-slate-950">
                    {selected ? <Check size={16} strokeWidth={2.3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-950">
                      {item === "xhigh" ? xhighLabel : reasoningLabels[item]}
                    </span>
                    <span className="mt-0.5 block text-sm leading-5 text-slate-500">
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
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const currentModel = getModelOption(value);

  useEffect(() => {
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
        className="flex h-10 max-w-44 items-center gap-1 rounded-full px-3 text-sm font-medium text-slate-900 hover:bg-[#e9e7e5] sm:max-w-none"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{currentModel.label}</span>
        <ChevronDown className="shrink-0 text-slate-700" size={15} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-3 w-80 overflow-hidden rounded-[1.35rem] bg-white py-2 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200"
          role="menu"
        >
          <div className="space-y-1 p-2">
            {MODEL_OPTIONS.map((item) => {
              const selected = item.id === value;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left ${
                    selected ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
                  }`}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-slate-950">
                    {selected ? <Check size={16} strokeWidth={2.3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-950">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-sm leading-5 text-slate-500">
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
