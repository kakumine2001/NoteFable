"use client";

import {
  ArrowRight, ArrowUp, BookOpen, Check, Copy, FilePenLine, FileText, Folder, Globe,
  History, Image as ImageIcon, Layers, Link2, MessageSquareText, NotebookPen,
  PanelRight, Paperclip, Play, Plus, Presentation, RotateCcw, Search, Shapes,
  Sparkles, Trash2, Wand2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { CharacterGraphic } from "@/components/character-avatar";
import { useT } from "@/components/i18n-provider";
import { useModels } from "@/components/models-provider";
import {
  CHARACTER_DEFINITIONS,
  DEFAULT_CHARACTER_ID,
  type CharacterId,
  type CharacterState,
} from "@/lib/characters";
import { msg } from "@/lib/i18n/translate";
import type { ReasoningEffort } from "@/lib/models";

type CanvasKind = "notes" | "whiteboards" | "slides";

const HERO_QUESTIONS = [
  "Why is the sunset red if the sky is blue?",
  "为什么天空是蓝的，晚霞却是红的？",
  "空は青いのに、夕焼けはなぜ赤い？",
  "Turn these optics notes into a 6-slide deck.",
];

function TypedComposerPreview() {
  const [text, setText] = useState(HERO_QUESTIONS[0]);

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0;
    let chars = Array.from(HERO_QUESTIONS[0]);
    let shown = chars.length;
    let erasing = true;
    let timer = window.setTimeout(step, 2900);

    function step() {
      let delay: number;
      if (erasing) {
        shown = Math.max(0, shown - 2);
        delay = 16;
        if (shown === 0) {
          index = (index + 1) % HERO_QUESTIONS.length;
          chars = Array.from(HERO_QUESTIONS[index]);
          erasing = false;
          delay = 360;
        }
      } else {
        shown += 1;
        delay = chars[shown - 1].charCodeAt(0) > 0x2e7f ? 78 : 32;
        if (shown === chars.length) {
          erasing = true;
          delay = 2900;
        }
      }
      setText(chars.slice(0, shown).join(""));
      timer = window.setTimeout(step, delay);
    }

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <span className="lp-mini-composer-text" aria-hidden="true">
      {text}
      <i className="lp-caret" />
    </span>
  );
}

function renderHighlighted(text: string, term: string, asMark = false) {
  return text.split("{term}").flatMap((part, index) => {
    if (!index) return [part];
    return [asMark ? <mark key={index}>{term}</mark> : <strong key={index}>{term}</strong>, part];
  });
}

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: msg("None"),
  minimal: msg("Low"),
  low: msg("Low"),
  medium: msg("Medium"),
  high: msg("High"),
  xhigh: msg("XHigh"),
  max: msg("Max"),
};

export function HeroStudioStage() {
  const t = useT();
  const { options: modelOptions, defaultModel } = useModels();
  const defaultModelLabel = modelOptions.find((m) => m.id === defaultModel)?.label ?? modelOptions[0]?.label ?? "AI";

  const [canvas, setCanvas] = useState<CanvasKind>("notes");
  const [autoPlay, setAutoPlay] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heroProposalApplied, setHeroProposalApplied] = useState(false);

  useEffect(() => {
    if (!autoPlay || hovered || focused) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const order: CanvasKind[] = ["notes", "whiteboards", "slides"];
    const timer = window.setInterval(() => {
      setCanvas((prev) => order[(order.indexOf(prev) + 1) % order.length]);
    }, 6800);
    return () => window.clearInterval(timer);
  }, [autoPlay, hovered, focused]);

  const selectCanvas = (next: CanvasKind) => {
    setAutoPlay(false);
    setCanvas(next);
  };

  const tabs: { id: CanvasKind; label: string; icon: typeof BookOpen }[] = [
    { id: "notes", label: t("Notes"), icon: BookOpen },
    { id: "whiteboards", label: t("Whiteboards"), icon: Shapes },
    { id: "slides", label: t("Slides"), icon: Presentation },
  ];

  const activeIndex = tabs.findIndex((item) => item.id === canvas);
  const companionState: CharacterState =
    canvas === "notes" ? (heroProposalApplied ? "completed" : "responding")
      : canvas === "whiteboards" ? "thinking"
        : "completed";

  return (
    <div
      className="lp-studio-shell"
      data-canvas={canvas}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      aria-label={t("Interactive studio preview")}
    >
      <div className="lp-studio-halo" aria-hidden="true" />
      <div className="lp-studio-window">
        <div className="lp-studio-chrome">
          <div className="lp-chrome-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div
            className="lp-canvas-tabs"
            role="group"
            aria-label={t("Choose a Workspace canvas")}
            style={{ "--tab-index": activeIndex } as CSSProperties}
          >
            <span className="lp-canvas-tab-indicator" aria-hidden="true" />
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = canvas === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  data-kind={tab.id}
                  className="lp-canvas-tab"
                  onClick={() => selectCanvas(tab.id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <span className="lp-chrome-badge">
            <PanelRight size={13} aria-hidden="true" />
            <span>{t("Split-screen studio")}</span>
          </span>
        </div>

        <div className="lp-studio-split">
          {/* Left Pane: AI Chat */}
          <div className="lp-pane lp-pane-chat">
            <div className="lp-pane-head">
              <span className="lp-pane-pill">
                <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={20} state={companionState} animated />
                <span>{t("Chat")}</span>
              </span>
              <span className="lp-model-chip">{defaultModelLabel}</span>
            </div>

            <div className="lp-chat-thread" key={canvas}>
              <div className="lp-chat-user-wrap">
                <p className="lp-chat-bubble">
                  {canvas === "notes" && t("Why is the sunset red if the sky is blue?")}
                  {canvas === "whiteboards" && t("Draw Rayleigh scattering as a mind map.")}
                  {canvas === "slides" && t("Turn this note into a 6-slide deck.")}
                </p>
                {canvas === "notes" && (
                  <span className="lp-attach-chip" dir="ltr">
                    <Paperclip size={12} aria-hidden="true" />
                    optics-ch3.pdf
                  </span>
                )}
              </div>

              <div className="lp-chat-ai">
                <div className="lp-chat-ai-meta">
                  {canvas === "notes" && (
                    <>
                      <Globe size={12} aria-hidden="true" />
                      <span>{t("Searched the web · 3 sources")}</span>
                    </>
                  )}
                  {canvas === "whiteboards" && (
                    <>
                      <Shapes size={12} aria-hidden="true" />
                      <span>{t("Draw as diagram")}</span>
                    </>
                  )}
                  {canvas === "slides" && (
                    <>
                      <Sparkles size={12} aria-hidden="true" />
                      <span>{t("Generate slides")}</span>
                    </>
                  )}
                </div>

                {canvas === "notes" && (
                  <p className="lp-chat-ai-body">
                    {renderHighlighted(
                      t("Both come from {term}. Air scatters short blue wavelengths the most, so at noon blue reaches you from every direction. At sunset the light crosses far more air, the blue is scattered away, and red is what is left."),
                      t("Rayleigh scattering"),
                    )}
                  </p>
                )}
                {canvas === "whiteboards" && (
                  <p className="lp-chat-ai-body">
                    {t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}
                  </p>
                )}
                {canvas === "slides" && (
                  <p className="lp-chat-ai-body">
                    {t("6 slides · ready to present")}
                  </p>
                )}

                <div className="lp-chat-actions" aria-hidden="true">
                  <span><Copy size={12} /> {t("Copy")}</span>
                  <span className="lp-chat-action-accent">
                    {canvas === "notes" && <><NotebookPen size={12} /> {t("Save to page")}</>}
                    {canvas === "whiteboards" && <><Shapes size={12} /> {t("Draw as diagram")}</>}
                    {canvas === "slides" && <><Presentation size={12} /> {t("Present")}</>}
                  </span>
                </div>
              </div>
            </div>

            <Link className="lp-mini-composer" href="/app" prefetch={false} aria-label={t("Open NoteFable and ask a question")}>
              <TypedComposerPreview />
              <span className="lp-mini-composer-bar" aria-hidden="true">
                <span className="lp-mini-plus"><Plus size={15} /></span>
                <span className="lp-mini-send"><ArrowUp size={15} /></span>
              </span>
            </Link>
          </div>

          <div className="lp-split-divider" aria-hidden="true">
            <span className="lp-split-grip" />
          </div>

          {/* Right Pane: Live Workspace */}
          <div className="lp-pane lp-pane-workspace" key={`ws-${canvas}`}>
            <div className="lp-pane-head">
              <span className="lp-pane-pill" data-kind={canvas}>
                {canvas === "notes" && <><BookOpen size={14} aria-hidden="true" /> {t("Notes")}</>}
                {canvas === "whiteboards" && <><Shapes size={14} aria-hidden="true" /> {t("Whiteboards")}</>}
                {canvas === "slides" && <><Presentation size={14} aria-hidden="true" /> {t("Slides")}</>}
              </span>
              <span className="lp-save-pill">
                <i className="lp-save-dot" aria-hidden="true" />
                {t("Saved · history kept")}
              </span>
            </div>

            {canvas === "notes" && (
              <div className="lp-ws-note">
                <div className="lp-ws-note-head">
                  <span className="lp-ws-emoji" aria-hidden="true">🌅</span>
                  <div>
                    <p className="lp-ws-note-title">{t("Why sunsets are red")}</p>
                    <div className="lp-ws-note-tags">
                      <span className="lp-katex-chip" dir="ltr">I(λ) ∝ 1/λ⁴</span>
                      <span className="lp-backlink-chip">@ {t("Physics 101")}</span>
                    </div>
                  </div>
                </div>

                {heroProposalApplied && (
                  <div className="lp-inserted-callout" role="status">
                    <Sparkles size={13} aria-hidden="true" />
                    <p>{t("In short: at sunset the light crosses more air, the blue is scattered away, and red is left.")}</p>
                  </div>
                )}

                <ul className="lp-ws-bullets">
                  <li>{t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}</li>
                  <li>{t("Noon: short path, blue from everywhere")}</li>
                  <li>{t("Sunset: long path, blue removed, red remains")}</li>
                </ul>

                <div className="lp-inline-proposal" data-applied={heroProposalApplied || undefined}>
                  <div className="lp-inline-proposal-top">
                    <span className="lp-inline-proposal-label">
                      <FilePenLine size={12} aria-hidden="true" />
                      {t("Proposed edit to “{title}”", { title: t("Why sunsets are red") })}
                    </span>
                    <button
                      type="button"
                      className="lp-inline-proposal-btn"
                      onClick={() => {
                        setAutoPlay(false);
                        setHeroProposalApplied((v) => !v);
                      }}
                    >
                      {heroProposalApplied ? (
                        <><RotateCcw size={12} aria-hidden="true" /> {t("Undo")}</>
                      ) : (
                        <><Check size={12} aria-hidden="true" /> {t("Apply")}</>
                      )}
                    </button>
                  </div>
                  {!heroProposalApplied && (
                    <div className="lp-inline-proposal-diff">
                      <span>{t("{op} · start of note", { op: t("Insert") })}</span>
                      <p>{t("In short: at sunset the light crosses more air, the blue is scattered away, and red is left.")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {canvas === "whiteboards" && (
              <div className="lp-ws-board">
                <div className="lp-board-canvas" dir="ltr" aria-hidden="true">
                  <svg className="lp-board-svg" viewBox="0 0 400 220" preserveAspectRatio="none" fill="none">
                    <path className="lp-board-edge lp-edge-1" d="M136 110 C172 110, 172 48, 208 48" vectorEffect="non-scaling-stroke" />
                    <path className="lp-board-edge lp-edge-2" d="M136 110 C172 110, 172 110, 208 110" vectorEffect="non-scaling-stroke" />
                    <path className="lp-board-edge lp-edge-3" d="M136 110 C172 110, 172 172, 208 172" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="lp-mm-root" dir="auto">{t("Rayleigh scattering")}</div>
                  <div className="lp-mm-branch lp-mm-b1" dir="auto">{t("Sunlight")}</div>
                  <div className="lp-mm-branch lp-mm-b2" dir="auto">{t("Short λ (blue) scatters 5.5×")}</div>
                  <div className="lp-mm-branch lp-mm-b3" dir="auto">{t("Long λ (red) reaches you")}</div>
                  <div className="lp-sticky-note" dir="ltr">I ∝ 1/λ⁴</div>
                </div>
                <div className="lp-ws-toolbar">
                  <span><Shapes size={12} aria-hidden="true" /> {t("Mind map")}</span>
                  <span><FileText size={12} aria-hidden="true" /> {t("Import PDF")}</span>
                  <span><Wand2 size={12} aria-hidden="true" /> {t("Turn into image")}</span>
                </div>
              </div>
            )}

            {canvas === "slides" && (
              <div className="lp-ws-slides">
                <div className="lp-slide-stage">
                  <span className="lp-slide-kicker">{t("Physics 101")}</span>
                  <p className="lp-slide-title">{t("Why sunsets are red")}</p>
                  <p className="lp-slide-sub">{t("Rayleigh scattering")}</p>
                  <div className="lp-spectrum-viz" aria-hidden="true">
                    <span className="lp-wave lp-wave-blue" />
                    <span className="lp-wave lp-wave-amber" />
                    <span className="lp-wave lp-wave-red" />
                  </div>
                </div>
                <div className="lp-slide-strip" aria-hidden="true">
                  <span className="is-active">01</span>
                  <span>02</span>
                  <span>03</span>
                  <span>04</span>
                </div>
                <div className="lp-ws-toolbar">
                  <span><Presentation size={12} aria-hidden="true" /> {t("Import PowerPoint")}</span>
                  <span><FileText size={12} aria-hidden="true" /> {t("Export PDF")}</span>
                  <span><Play size={12} aria-hidden="true" /> {t("Present")}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type SlideThemeKey = "paper" | "ink" | "cobalt" | "warm";

const SLIDE_THEMES: { id: SlideThemeKey; swatch: string }[] = [
  { id: "paper", swatch: "#ffffff" },
  { id: "ink", swatch: "#0f172a" },
  { id: "cobalt", swatch: "#1e3a8a" },
  { id: "warm", swatch: "#fef3c7" },
];

export function BentoSlidesPreview() {
  const t = useT();
  const [theme, setTheme] = useState<SlideThemeKey>("cobalt");

  return (
    <div className="lp-bento-slides-demo">
      <div className="lp-mini-deck" data-slide-theme={theme}>
        <div className="lp-mini-deck-top">
          <span className="lp-mini-deck-tag">01 / 06</span>
          <div className="lp-theme-swatches" role="group" aria-label={t("Choose slide theme")}>
            {SLIDE_THEMES.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className="lp-theme-dot"
                aria-pressed={theme === item.id}
                aria-label={`${t("Theme")} ${idx + 1}`}
                style={{ "--swatch": item.swatch } as CSSProperties}
                onClick={() => setTheme(item.id)}
              />
            ))}
          </div>
        </div>
        <p className="lp-mini-deck-title">{t("Why sunsets are red")}</p>
        <p className="lp-mini-deck-sub">{t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}</p>
        <div className="lp-mini-deck-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="lp-chip-row">
        <span>{t("Import PowerPoint")}</span>
        <span>{t("Export PDF")}</span>
        <span>{t("Presenter view")}</span>
        <span>{t("Speaker notes")}</span>
      </div>
    </div>
  );
}

export function BentoWhiteboardPreview() {
  const t = useT();
  return (
    <div className="lp-bento-board-demo">
      <div className="lp-sketch-morph">
        <div className="lp-sketch-box">
          <span className="lp-sketch-label">{t("Sketch")}</span>
          <svg viewBox="0 0 110 68" fill="none" aria-hidden="true">
            <path d="M12 52 L38 22 L58 42 L74 28 L98 52 Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />
            <circle cx="76" cy="18" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2" />
          </svg>
        </div>
        <span className="lp-sketch-arrow" aria-hidden="true">
          <Wand2 size={14} />
        </span>
        <div className="lp-rendered-box">
          <span className="lp-sketch-label">{t("AI image")}</span>
          <div className="lp-rendered-sunset" aria-hidden="true">
            <i className="lp-rendered-sun" />
            <i className="lp-rendered-ridge-back" />
            <i className="lp-rendered-ridge-front" />
          </div>
        </div>
      </div>
      <div className="lp-chip-row">
        <span>{t("Mind map")}</span>
        <span>{t("Cornell notes")}</span>
        <span>{t("Timeline")}</span>
        <span>{t("Venn diagram")}</span>
        <span>{t("Import PDF")}</span>
      </div>
    </div>
  );
}

type ProposalDemoState = "idle" | "applied" | "undone";

export function ProposalSandbox() {
  const t = useT();
  const [target, setTarget] = useState<CanvasKind>("notes");
  const [states, setStates] = useState<Record<CanvasKind, ProposalDemoState>>({
    notes: "idle",
    whiteboards: "idle",
    slides: "idle",
  });

  const status = states[target];
  const isApplied = status === "applied";
  const toggleApply = () =>
    setStates((prev) => ({
      ...prev,
      [target]: prev[target] === "applied" ? "undone" : "applied",
    }));

  return (
    <div className="lp-proposal-sandbox">
      <div className="lp-pill-switch" role="group" aria-label={t("Choose a Workspace canvas")}>
        {(
          [
            { id: "notes", label: t("Notes"), icon: BookOpen },
            { id: "whiteboards", label: t("Whiteboards"), icon: Shapes },
            { id: "slides", label: t("Slides"), icon: Presentation },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={target === id}
            data-kind={id}
            onClick={() => setTarget(id)}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="lp-proposal-card" data-kind={target} data-applied={isApplied || undefined}>
        <div className="lp-proposal-meta">
          <FilePenLine size={13} aria-hidden="true" />
          <span>{t("Proposed edit to “{title}”", { title: t("Why sunsets are red") })}</span>
          <span className="lp-auto-tag">{t("Auto-apply")}</span>
        </div>

        <div className="lp-proposal-diff">
          {target === "notes" && (
            <>
              <span className="lp-proposal-op">{t("{op} · start of note", { op: t("Insert") })}</span>
              <p>{t("In short: at sunset the light crosses more air, the blue is scattered away, and red is left.")}</p>
            </>
          )}
          {target === "whiteboards" && (
            <>
              <span className="lp-proposal-op">{t("Whiteboard")}</span>
              <p>{t("Add 3 mind-map branches for wavelength")}</p>
            </>
          )}
          {target === "slides" && (
            <>
              <span className="lp-proposal-op">{t("Slides")}</span>
              <p>{t("Restyle all 6 slides to Dark Slate theme")}</p>
            </>
          )}
        </div>

        <div className="lp-proposal-footer">
          <button type="button" className="lp-btn-apply" onClick={toggleApply}>
            {isApplied ? (
              <><RotateCcw size={13} aria-hidden="true" /> {t("Undo")}</>
            ) : (
              <><Check size={13} aria-hidden="true" /> {t("Apply")}</>
            )}
          </button>
          <span className="lp-proposal-status" aria-live="polite">
            {status === "applied" ? t("Applied") : status === "undone" ? t("Undone") : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ModelReasoningEngine() {
  const t = useT();
  const { options: modelOptions, defaultModel } = useModels();
  const [selectedModelId, setSelectedModelId] = useState(defaultModel);

  const selectedModel = modelOptions.find((m) => m.id === selectedModelId) ?? modelOptions[0];
  const efforts = selectedModel?.reasoningEfforts ?? (["low", "medium", "high"] as const);
  const [effort, setEffort] = useState<ReasoningEffort>(selectedModel?.defaultReasoning ?? "medium");

  const activeEffort = efforts.includes(effort) ? effort : (selectedModel?.defaultReasoning ?? efforts[0]);
  const depthIndex = Math.max(0, efforts.indexOf(activeEffort));
  const depthRatio = efforts.length > 1 ? depthIndex / (efforts.length - 1) : 0.6;

  return (
    <div className="lp-model-engine">
      <div className="lp-model-list" role="group" aria-label={t("Available models")}>
        {modelOptions.map((model) => {
          const active = model.id === selectedModel?.id;
          return (
            <button
              key={model.id}
              type="button"
              aria-pressed={active}
              className="lp-model-pill"
              data-provider={model.provider}
              onClick={() => {
                setSelectedModelId(model.id);
                setEffort(model.defaultReasoning);
              }}
            >
              <i className="lp-provider-dot" aria-hidden="true" />
              <span>{model.label}</span>
            </button>
          );
        })}
      </div>

      <div className="lp-reasoning-panel">
        <div className="lp-reasoning-top">
          <span>{t("Reasoning depth")}</span>
          <strong>{t(EFFORT_LABELS[activeEffort])}</strong>
        </div>

        <div className="lp-reasoning-track" role="group" aria-label={t("Reasoning depth")}>
          {efforts.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={level === activeEffort}
              className="lp-effort-step"
              data-provider={selectedModel?.provider}
              onClick={() => setEffort(level)}
            >
              {t(EFFORT_LABELS[level])}
            </button>
          ))}
        </div>

        <div className="lp-thinking-meter" aria-hidden="true" style={{ "--depth": depthRatio.toFixed(2) } as CSSProperties}>
          <span className="lp-thinking-bar" />
          <span className="lp-thinking-pulse" />
        </div>
      </div>

      <div className="lp-chip-row">
        {selectedModel?.supportsWebSearch && (
          <span><Globe size={12} aria-hidden="true" /> {t("Web search")}</span>
        )}
        <span><ImageIcon size={12} aria-hidden="true" /> {t("Create an image")}</span>
        <span><Sparkles size={12} aria-hidden="true" /> {t("Generate with AI")}</span>
      </div>
    </div>
  );
}

export function ReviewQuizWidget() {
  const t = useT();
  const [flipped, setFlipped] = useState(false);
  const answerText = t("Sunlight travels through far more atmosphere at sunset; short blue wavelengths scatter away first (∝ 1/λ⁴), leaving longer red wavelengths.");

  return (
    <div className="lp-quiz-widget">
      <button
        type="button"
        className="lp-flashcard-scene"
        aria-pressed={flipped}
        onClick={() => setFlipped((v) => !v)}
      >
        <div className="lp-flashcard" data-flipped={flipped || undefined}>
          <div className="lp-flashcard-face lp-flashcard-front" aria-hidden={flipped || undefined}>
            <span className="lp-flashcard-tag">{t("Question")}</span>
            <p>{t("Why does red light survive at sunset while blue disappears?")}</p>
            <span className="lp-flashcard-hint">
              <RotateCcw size={12} aria-hidden="true" /> {t("Tap card to flip")}
            </span>
          </div>
          <div className="lp-flashcard-face lp-flashcard-back" aria-hidden={!flipped || undefined}>
            <span className="lp-flashcard-tag">{t("Answer")}</span>
            <p>{answerText}</p>
            <span className="lp-flashcard-hint">
              <Check size={12} aria-hidden="true" /> {t("Save review note")}
            </span>
          </div>
        </div>
      </button>
      <span className="lp-sr" aria-live="polite">{flipped ? `${t("Answer")}: ${answerText}` : ""}</span>

      <div className="lp-chip-row">
        <span><Sparkles size={12} aria-hidden="true" /> {t("Quiz me")}</span>
        <span><Layers size={12} aria-hidden="true" /> {t("Flashcards")}</span>
        <span><NotebookPen size={12} aria-hidden="true" /> {t("Save review note")}</span>
      </div>
    </div>
  );
}

export function HybridSearchDemo() {
  const t = useT();
  const [mode, setMode] = useState<"folded" | "semantic">("folded");

  return (
    <div className="lp-search-demo">
      <div className="lp-pill-switch" role="group" aria-label={t("Search")}>
        <button type="button" aria-pressed={mode === "folded"} onClick={() => setMode("folded")}>
          {t("Spelling-folded")}
        </button>
        <button type="button" aria-pressed={mode === "semantic"} onClick={() => setMode("semantic")}>
          {t("Semantic match")}
        </button>
      </div>

      <div className="lp-search-card">
        <div className="lp-search-input">
          <Search size={15} aria-hidden="true" />
          <span className="lp-search-query" dir={mode === "folded" ? "ltr" : undefined}>
            {mode === "folded" ? "ｒａｙｌｅｉｇｈ" : t("why sky turns orange at dusk")}
          </span>
          <kbd>{mode === "folded" ? t("full-width, lower-case") : t("Matched by meaning")}</kbd>
        </div>

        <ul className="lp-search-results" key={mode}>
          <li>
            <BookOpen size={14} aria-hidden="true" />
            <div>
              <strong>{t("Why sunsets are red")}</strong>
              <p>
                {mode === "folded"
                  ? renderHighlighted(t("{term} scattering · Scattering ∝ 1/λ⁴…"), "Rayleigh", true)
                  : t("Sunset: long path, blue removed, red remains")}
              </p>
            </div>
          </li>
          {mode === "folded" ? (
            <>
              <li>
                <MessageSquareText size={14} aria-hidden="true" />
                <div>
                  <strong>{t("Sunset colours")}</strong>
                  <p>{renderHighlighted(t("Both come from {term} scattering. Air scatters…"), "Rayleigh", true)}</p>
                </div>
              </li>
              <li>
                <FileText size={14} aria-hidden="true" />
                <div>
                  <strong dir="ltr">optics-ch3.pdf</strong>
                  <p>{renderHighlighted(t("3.2 {term} SCATTERING AND THE COLOUR OF…"), "RAYLEIGH", true)}</p>
                </div>
              </li>
            </>
          ) : (
            <li>
              <BookOpen size={14} aria-hidden="true" />
              <div>
                <strong>{t("Lens formula cheatsheet")}</strong>
                <p>{t("In short: at sunset the light crosses more air, the blue is scattered away, and red is left.")}</p>
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

const SHOWCASE_STATES: { id: CharacterState; labelKey: string }[] = [
  { id: "idle", labelKey: msg("Idle") },
  { id: "typing", labelKey: msg("Typing") },
  { id: "thinking", labelKey: msg("Thinking") },
  { id: "responding", labelKey: msg("Responding") },
  { id: "completed", labelKey: msg("Completed") },
];

export function CompanionsShowcase() {
  const t = useT();
  const [selected, setSelected] = useState<CharacterId>(DEFAULT_CHARACTER_ID);
  const [state, setState] = useState<CharacterState>("idle");
  const current = CHARACTER_DEFINITIONS.find((c) => c.id === selected) ?? CHARACTER_DEFINITIONS[0];

  return (
    <div className="lp-companions-grid">
      <div className="lp-companion-stage">
        <div className="lp-companion-pedestal" aria-hidden="true" />
        <CharacterGraphic key={selected} characterId={selected} size={118} state={state} hero animated />
        <span className="lp-companion-name">{current.name}</span>
      </div>

      <div className="lp-companion-controls">
        <div className="lp-companion-dock" role="group" aria-label={t("Choose a companion")}>
          {CHARACTER_DEFINITIONS.map((character) => {
            const active = character.id === selected;
            return (
              <button
                key={character.id}
                type="button"
                aria-pressed={active}
                className="lp-companion-tile"
                onClick={() => setSelected(character.id)}
              >
                <CharacterGraphic characterId={character.id} size={34} state={active ? state : "idle"} animated={active} />
                <span>{character.name}</span>
              </button>
            );
          })}
        </div>

        <div className="lp-state-pills" role="group" aria-label={current.name}>
          {SHOWCASE_STATES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={state === item.id}
              className="lp-state-pill"
              onClick={() => setState(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConnectedWorkspaceVisual() {
  const t = useT();
  return (
    <div className="lp-connected-demo">
      <div className="lp-connected-graph" aria-hidden="true">
        <div className="lp-conn-node lp-conn-note">
          <BookOpen size={14} />
          <span>{t("Why sunsets are red")}</span>
        </div>
        <div className="lp-conn-links">
          <span className="lp-conn-pill"><Link2 size={11} /> @ {t("Backlinks")}</span>
          <span className="lp-conn-pill"><Layers size={11} /> {t("Live embed")}</span>
        </div>
        <div className="lp-conn-row">
          <div className="lp-conn-node lp-conn-board">
            <Shapes size={14} />
            <span>{t("Mind map")}</span>
          </div>
          <div className="lp-conn-node lp-conn-slide">
            <Presentation size={14} />
            <span>{t("Slides")}</span>
          </div>
        </div>
      </div>

      <div className="lp-chip-row">
        <span><Link2 size={12} aria-hidden="true" /> {t("Public link")}</span>
        <span><History size={12} aria-hidden="true" /> {t("Version history")}</span>
        <span><Trash2 size={12} aria-hidden="true" /> {t("Trash")}</span>
      </div>
    </div>
  );
}

export function ProjectContextStrip() {
  const t = useT();
  return (
    <div className="lp-project-strip">
      <div className="lp-project-intro">
        <span className="lp-project-badge">
          <Folder size={14} aria-hidden="true" />
          <span>{t("Projects")}</span>
        </span>
        <h3>{t("Physics 101")}</h3>
        <p>{t("Organize chats with shared instructions and attached reference pages so AI always remembers your context.")}</p>
      </div>
      <dl className="lp-project-details">
        <div>
          <dt>{t("Instructions")}</dt>
          <dd className="lp-project-quote">{t("Explain with everyday examples. Quiz me at the end.")}</dd>
        </div>
        <div>
          <dt>{t("Reference pages")}</dt>
          <dd className="lp-project-chips">
            <span><BookOpen size={13} aria-hidden="true" /> {t("Why sunsets are red")}</span>
            <span><BookOpen size={13} aria-hidden="true" /> {t("Lens formula cheatsheet")}</span>
          </dd>
        </div>
        <div>
          <dt>{t("Chats")}</dt>
          <dd className="lp-project-chips">
            <span><MessageSquareText size={13} aria-hidden="true" /> {t("Sunset colours")}</span>
            <span><MessageSquareText size={13} aria-hidden="true" /> {t("Why is the ocean blue?")}</span>
            <span><MessageSquareText size={13} aria-hidden="true" /> {t("Polarised sunglasses")}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function BentoNotesPreview() {
  const t = useT();
  return (
    <div className="lp-bento-notes-demo">
      <div className="lp-mini-note-sheet">
        <div className="lp-mini-note-top">
          <span aria-hidden="true">🌅</span>
          <strong>{t("Why sunsets are red")}</strong>
          <span className="lp-katex-chip" dir="ltr">I ∝ 1/λ⁴</span>
        </div>
        <ul className="lp-ws-bullets">
          <li>{t("Noon: short path, blue from everywhere")}</li>
          <li>{t("Sunset: long path, blue removed, red remains")}</li>
        </ul>
        <div className="lp-mini-embed-bar">
          <Shapes size={12} aria-hidden="true" />
          <span>{t("Live embed")} · {t("Rayleigh scattering")}</span>
          <ArrowRight size={12} className="rtl-mirror" aria-hidden="true" />
        </div>
      </div>
      <div className="lp-chip-row">
        <span>{t("Import Markdown")}</span>
        <span>{t("Export Markdown")}</span>
        <span>{t("Present")}</span>
        <span>{t("Backlinks")}</span>
      </div>
    </div>
  );
}
