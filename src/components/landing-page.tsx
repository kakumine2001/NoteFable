"use client";

import {
  ArrowDown, ArrowRight, ArrowUp, BookOpen, BookOpenCheck, Check, Copy, FilePenLine, FileText, Folder, Globe, History,
  Link2, MessageSquareText, Moon, NotebookPen, Paperclip, Plus, Presentation, RotateCcw, Search, Shapes, Sparkles, Sun,
  Trash2, WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CharacterGraphic } from "@/components/character-avatar";
import { useT } from "@/components/i18n-provider";
import { LanguageMenu } from "@/components/language-menu";
import { useModels } from "@/components/models-provider";
import { saveLocaleIfSignedIn } from "@/lib/account-store";
import { CHARACTER_IDS, DEFAULT_CHARACTER_ID, getCharacterDefinition, type CharacterId, type CharacterState } from "@/lib/characters";
import { LANDING_HERO, landingTitle } from "@/lib/i18n/landing-meta";
import { LOCALES, LOCALE_DIRS, LOCALE_NAMES, LOCALE_TAGS, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { INTRO_HREF, landingPath } from "@/lib/i18n/routing";
import { afterSheetHistory } from "@/lib/use-back-to-close";

type T = ReturnType<typeof useT>;

// ページ全体が同じ一つの問い（夕焼けはなぜ赤い？）を追う。見本の中身はすべてこの問いから作る。
const FILE_NAME = "optics-ch3.pdf";

// 回答が流れてくる様子を、単語ごとの遅延（--i）で表す。{term} の位置に強調する語を差し込む。
function stream(text: string, emphasis: string) {
  const parts: Array<string | { strong: string }> = text.split("{term}").flatMap((part, index) =>
    index ? [{ strong: emphasis }, part] : [part]);
  let count = 0;
  return parts.flatMap((part, partIndex) => {
    const strong = typeof part !== "string";
    // 空白で区切る言語は単語ごと、中国語・日本語は読点・句点ごとに流す（区切りの文字は各片に残す）。
    return ((strong ? part.strong : part).match(/[^\s，。、！？]*[，。、！？]*\s*/g) ?? []).filter(Boolean).map((word, wordIndex) => {
      const style = { "--i": count++ } as CSSProperties;
      const key = `${partIndex}-${wordIndex}`;
      return strong
        ? <strong className="lp-w" style={style} key={key}>{word}</strong>
        : <span className="lp-w" style={style} key={key}>{word}</span>;
    });
  });
}

function highlight(text: string, term: string) {
  return text.split("{term}").flatMap((part, index) => index ? [<mark key={index}>{term}</mark>, part] : [part]);
}

const order = (n: number) => ({ "--n": n }) as CSSProperties;

function KindBadge({ kind, children }: { kind: "chat" | "note" | "slides" | "whiteboard" | "quiz"; children: ReactNode }) {
  const Icon = kind === "chat" ? MessageSquareText : kind === "note" ? FileText : kind === "slides" ? Presentation : kind === "whiteboard" ? Shapes : BookOpenCheck;
  return <span className={`lp-kind is-${kind}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}

// 中心の主題から 3 本の枝が伸びるマインドマップ。線は SVG、ラベルは HTML（訳文の長さに合わせて伸びる）。
function MindMap({ t }: { t: T }) {
  return (
    <div className="lp-map">
      <span className="lp-map-root">{t("Why sunsets are red")}</span>
      <span className="lp-map-lines">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true">
          <path d="M0 50C55 50 45 16 100 16" vectorEffect="non-scaling-stroke" />
          <path d="M0 50H100" vectorEffect="non-scaling-stroke" />
          <path d="M0 50C55 50 45 84 100 84" vectorEffect="non-scaling-stroke" />
        </svg>
      </span>
      <ul className="lp-map-leaves">
        <li style={order(0)}>{t("Sunlight")}</li>
        <li style={order(1)}>{t("Air scatters blue")}</li>
        <li style={order(2)}>{t("Red remains")}</li>
      </ul>
    </div>
  );
}

// ヒーローの舞台：真ん中のチャットから、ノート・スライド・ホワイトボードが配られる。飾りなので読み上げからは外す。
function HeroStage({ t, modelLabel }: { t: T; modelLabel: string }) {
  return (
    <div className="lp-stage" aria-hidden="true">
      <div className="lp-stage-tilt">
        {/* 広い画面では 左・中央・右 の 3 列（CSS の order）。狭い画面では中央の下に、左右のカードが横に並んで流せる。 */}
        <div className="lp-s-col is-center">
          <i className="lp-s-beam is-start" /><i className="lp-s-beam is-end" />
          <article className="lp-s-card lp-s-chat">
            <header>
              <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={20} />
              <b>NoteFable</b>
              <span className="lp-s-model">{modelLabel}</span>
            </header>
            <p className="lp-bubble">{t("Why is the sunset red if the sky is blue?")}</p>
            <div className="lp-s-answer">
              <span className="lp-s-meta"><Globe size={12} />{t("Searched the web · 3 sources")}</span>
              <p>{stream(t("Both come from {term}. Air scatters short blue wavelengths the most, so at noon blue reaches you from every direction. At sunset the light crosses far more air, the blue is scattered away, and red is what is left."), t("Rayleigh scattering"))}</p>
              <div className="lp-chips">
                <span><Copy size={12} />{t("Copy")}</span>
                <span className="is-accent"><NotebookPen size={12} />{t("Save to page")}</span>
              </div>
            </div>
            <div className="lp-composer">
              <Plus size={15} />
              <span>{t("Ask anything...")}</span>
              <i><ArrowUp size={14} /></i>
            </div>
          </article>
        </div>

        <div className="lp-s-sides">
        <div className="lp-s-col is-start">
          <article className="lp-s-card lp-s-note">
            <KindBadge kind="note">{t("Note")}</KindBadge>
            <span className="lp-s-emoji">🌅</span>
            <h3>{t("Why sunsets are red")}</h3>
            <h4>{t("Rayleigh scattering")}</h4>
            <ul>
              <li>{t("Noon: short path, blue from everywhere")}</li>
              <li>{t("Sunset: long path, blue removed, red remains")}</li>
            </ul>
            <span className="lp-s-meta"><History size={12} />{t("Saved · history kept")}</span>
          </article>
        </div>

        <div className="lp-s-col is-end">
          <article className="lp-s-card lp-s-slides">
            <KindBadge kind="slides">{t("Slides")}</KindBadge>
            <div className="lp-slide">
              <b>{t("Why sunsets are red")}</b>
              <span>{t("Rayleigh scattering")}</span>
              <i />
            </div>
          </article>
          <article className="lp-s-card lp-s-board">
            <KindBadge kind="whiteboard">{t("Whiteboard")}</KindBadge>
            <MindMap t={t} />
          </article>
        </div>
        </div>
      </div>
    </div>
  );
}

// 回答の横のキャラクター。入力待ち → 考える → 答える → 完了、と実物と同じ状態を順に見せる。
// 親が key を変えて作り直すので、状態は初期値から始まる（effect で戻さない）。
// scripted が false（JS が動く前、または動きを減らす設定）のときは、回答が全部出ているので「完了」のままにする。
function AnswerMascot({ live, scripted }: { live: boolean; scripted: boolean }) {
  const [state, setState] = useState<CharacterState>(!scripted ? "completed" : live ? "thinking" : "idle");
  useEffect(() => {
    if (!live || !scripted) return;
    const timers = [window.setTimeout(() => setState("responding"), 1000), window.setTimeout(() => setState("completed"), 3900)];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [live, scripted]);
  return <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={30} state={state} animated />;
}

// panel(live, scripted): live はその段の見本が動いているか、scripted は JS が動き出し、動きを減らす設定でもないか。
type Step = { id: string; label: string; title: string; body: string; panel: (live: boolean, scripted: boolean) => ReactNode };

function useSteps(t: T): Step[] {
  const { options: modelOptions, defaultModel } = useModels();
  return [
    {
      id: "ask",
      label: t("Ask"),
      title: t("Start with a question, a file or a photo."),
      body: t("Choose a model and how deeply it thinks. It can search the web and cite its sources, read your PDFs and images, or create a picture when that explains it better."),
      panel: (live, scripted) => (
        <>
          <header className="lp-win-bar"><KindBadge kind="chat">{t("Chat")}</KindBadge>
            <ul className="lp-models" aria-label={t("Available models")}>
              {modelOptions.map((model) => <li key={model.id} data-current={model.id === defaultModel || undefined}>{model.label}</li>)}
            </ul>
          </header>
          <div className="lp-win-body lp-chat">
            <p className="lp-bubble lp-seq" style={order(0)}>{t("Why is the sunset red if the sky is blue?")}</p>
            <span className="lp-file lp-seq" style={order(1)}><Paperclip size={13} aria-hidden="true" />{FILE_NAME}</span>
            <div className="lp-answer lp-seq" style={order(3)}>
              <span className="lp-answer-face" aria-hidden="true"><AnswerMascot key={`${live}-${scripted}`} live={live} scripted={scripted} /></span>
              <div>
                <span className="lp-meta lp-seq" style={order(3)}><Globe size={13} aria-hidden="true" />{t("Searched the web · 3 sources")}</span>
                <p className="lp-stream">{stream(t("Both come from {term}. Air scatters short blue wavelengths the most, so at noon blue reaches you from every direction. At sunset the light crosses far more air, the blue is scattered away, and red is what is left."), t("Rayleigh scattering"))}</p>
                {/* 回答が流れ終わってから出す（遅延は landing.css の .lp-chat .lp-chips）。 */}
                <div className="lp-chips lp-seq" style={order(4)}>
                  <span><Copy size={13} aria-hidden="true" />{t("Copy")}</span>
                  <span className="is-accent"><NotebookPen size={13} aria-hidden="true" />{t("Save to page")}</span>
                </div>
              </div>
            </div>
            <div className="lp-composer lp-seq" style={order(2)}>
              <Plus size={16} aria-hidden="true" />
              <span>{t("Ask anything...")}</span>
              <i><ArrowUp size={15} aria-hidden="true" /></i>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "keep",
      label: t("Keep"),
      title: t("Keep the answer as a note."),
      body: t("Save any answer to your Workspace in one click. Ask the AI to rewrite or extend the note: it proposes the change, and nothing is written until you apply it."),
      panel: () => (
        <>
          <header className="lp-win-bar"><KindBadge kind="note">{t("Note")}</KindBadge><span className="lp-meta"><History size={13} aria-hidden="true" />{t("Saved · history kept")}</span></header>
          <div className="lp-win-body lp-note">
            <span className="lp-note-emoji lp-seq" style={order(0)} aria-hidden="true">🌅</span>
            <h4 className="lp-seq" style={order(1)}>{t("Why sunsets are red")}</h4>
            {/* 提案を適用すると、この一行がノートの先頭に入る。 */}
            <div className="lp-note-insert"><p>{t("In short: at sunset the light crosses more air, the blue is scattered away, and red is left.")}</p></div>
            <h5 className="lp-seq" style={order(2)}>{t("Rayleigh scattering")}</h5>
            <ul>
              <li className="lp-seq" style={order(3)}>{t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}</li>
              <li className="lp-seq" style={order(4)}>{t("Noon: short path, blue from everywhere")}</li>
              <li className="lp-seq" style={order(5)}>{t("Sunset: long path, blue removed, red remains")}</li>
            </ul>
            {/* 実物の提案カード（page-proposal.tsx）と同じアイコン・文言を使う。 */}
            <div className="lp-proposal">
              <span className="lp-meta"><FilePenLine size={13} aria-hidden="true" />{t("Proposed edit to “{title}”", { title: t("Why sunsets are red") })}</span>
              <span className="lp-proposal-op">{t("{op} · start of note", { op: t("Insert") })}</span>
              <div className="lp-chips">
                <span className="is-solid"><Check size={13} aria-hidden="true" />{t("Apply")}</span>
                <span>{t("Discard")}</span>
              </div>
            </div>
            {/* 適用のあとは、取り消せることを見せる。 */}
            <div className="lp-chips lp-applied">
              <span className="is-done"><Check size={13} aria-hidden="true" />{t("Applied")}</span>
              <span><RotateCcw size={13} aria-hidden="true" />{t("Undo")}</span>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "make",
      label: t("Make"),
      title: t("Turn it into slides and whiteboards."),
      body: t("Generate a deck from a topic, a note or a whole chat, then present it full screen or export it to PowerPoint and PDF. Or have the AI draw it as a diagram you can edit."),
      panel: () => (
        <>
          <header className="lp-win-bar"><KindBadge kind="slides">{t("Slides")}</KindBadge><span className="lp-meta"><Sparkles size={13} aria-hidden="true" />{t("Generate slides")}</span></header>
          <div className="lp-win-body lp-make">
            <div className="lp-deck">
              <ol className="lp-deck-rail" aria-label={t("Outline")}>
                <li className="lp-seq" style={order(0)} data-current><i />{t("Why sunsets are red")}</li>
                <li className="lp-seq" style={order(1)}><i />{t("Rayleigh scattering")}</li>
                <li className="lp-seq" style={order(2)}><i />{t("Red remains")}</li>
              </ol>
              <div className="lp-slide lp-seq" style={order(3)}>
                <b>{t("Why sunsets are red")}</b>
                <span>{t("Rayleigh scattering")}</span>
                <i aria-hidden="true" />
              </div>
            </div>
            <div className="lp-board lp-seq" style={order(5)}>
              <KindBadge kind="whiteboard">{t("Mind map")}</KindBadge>
              <MindMap t={t} />
            </div>
          </div>
        </>
      ),
    },
    {
      id: "review",
      label: t("Review"),
      title: t("Quiz yourself before you forget."),
      body: t("Turn any note or deck into a practice quiz or flashcards, and save the questions as a review note."),
      panel: () => (
        <>
          <header className="lp-win-bar"><KindBadge kind="quiz">{t("Review & quiz")}</KindBadge><span className="lp-meta">{t("Question {current} of {total}", { current: 1, total: 5 })}</span></header>
          <div className="lp-win-body lp-quiz">
            <p className="lp-quiz-q lp-seq" style={order(0)}>{t("Why does the sky turn red at sunset?")}</p>
            <ul aria-label={t("Multiple choice")}>
              <li className="lp-seq" style={order(1)}><i>A</i>{t("The sun gives off redder light in the evening")}</li>
              <li className="lp-seq is-right" style={order(2)}><i>B</i>{t("Sunlight crosses more air, so the blue is scattered away")}<span className="lp-quiz-ok"><Check size={13} aria-hidden="true" />{t("Correct")}</span></li>
              <li className="lp-seq" style={order(3)}><i>C</i>{t("Red light scatters the most")}</li>
            </ul>
            <div className="lp-flash lp-seq" style={order(4)}>
              <div className="lp-flash-card">
                <span className="lp-flash-face"><small>{t("Flashcards")}</small><b>{t("Rayleigh scattering")}</b></span>
                <span className="lp-flash-face is-back"><small>{t("Answer")}</small><b>{t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}</b></span>
              </div>
              <span className="lp-chips"><span className="is-accent"><NotebookPen size={13} aria-hidden="true" />{t("Save review note")}</span></span>
            </div>
          </div>
        </>
      ),
    },
  ];
}

// 手描きの下書きが、AI の作った夕焼けの絵に変わっていく。
function SketchArt() {
  return (
    <div className="lp-sketch" aria-hidden="true">
      <svg className="lp-sketch-draft" viewBox="0 0 320 180" fill="none" preserveAspectRatio="xMidYMid slice">
        <path d="M112 118c2-30 24-52 49-51 26 1 46 23 47 51" />
        <path d="M160 46v-16M103 68 92 56M217 68l11-12M78 104l-15-4M242 104l15-4" />
        <path d="M22 119c40-4 72 3 110 0s80-4 118-1 34 2 48 1" />
        <path d="M58 138c30-3 54 2 86 0s66-3 98 0M92 156c26-2 44 2 70 0s40-2 62 0" />
      </svg>
      <svg className="lp-sketch-final" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b3f9e" /><stop offset="0.42" stopColor="#c0508f" /><stop offset="0.66" stopColor="#f6924a" /><stop offset="0.67" stopColor="#7a3a78" /><stop offset="1" stopColor="#261d4f" />
          </linearGradient>
          <radialGradient id="lp-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#fff6cf" /><stop offset="0.5" stopColor="#ffd36b" /><stop offset="1" stopColor="#ffb14a" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="320" height="180" fill="url(#lp-sky)" />
        <circle cx="160" cy="119" r="86" fill="url(#lp-sun)" opacity="0.55" />
        <path d="M112 119a48 48 0 0 1 96 0z" fill="#ffe7a3" />
        <path d="M0 119h320v61H0z" fill="#2a1f55" opacity="0.72" />
        <path d="M118 128h84M132 140h56M146 152h28M152 164h16" stroke="#ffcf7a" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      </svg>
      <i className="lp-sketch-edge" />
    </div>
  );
}

function Characters() {
  const [hot, setHot] = useState<CharacterId | null>(null);
  return (
    <ul className="lp-chars" aria-hidden="true" onPointerLeave={() => setHot(null)}>
      {CHARACTER_IDS.map((id, index) => (
        <li key={id} style={order(index)} onPointerEnter={() => { if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setHot(id); }}>
          <CharacterGraphic characterId={id} size={46} animated state={hot === id ? "responding" : "idle"} />
          <span>{getCharacterDefinition(id).name}</span>
        </li>
      ))}
    </ul>
  );
}

function LanguageRows() {
  // 2 段を逆向きに流す。途切れないよう同じ並びを 2 回置く。言語名はそれぞれの言語のまま。
  const row = (locales: readonly Locale[]) => [0, 1].map((copy) => (
    <span key={copy}>{locales.map((locale) => <bdi key={locale} lang={LOCALE_TAGS[locale]} dir={LOCALE_DIRS[locale]}>{LOCALE_NAMES[locale]}</bdi>)}</span>
  ));
  const half = Math.ceil(LOCALES.length / 2);
  return (
    <div className="lp-langs" dir="ltr" aria-hidden="true">
      <div className="lp-langs-row is-light"><Sun size={14} /><div>{row(LOCALES.slice(0, half))}</div></div>
      <div className="lp-langs-row is-dark"><Moon size={14} /><div>{row(LOCALES.slice(half))}</div></div>
    </div>
  );
}

type Feature = { id: string; size: "wide" | "third"; title: string; body: string; art: ReactNode };

function useFeatures(t: T): Feature[] {
  const { options: modelOptions, defaultModel } = useModels();
  return [
    {
      id: "models",
      size: "wide",
      title: t("Several models, one conversation."),
      body: t("Switch models whenever you like and set how hard each one thinks."),
      art: (
        <div className="lp-art-models" aria-hidden="true">
          <ul className="lp-models">{modelOptions.map((model) => <li key={model.id} data-current={model.id === defaultModel || undefined}>{model.label}</li>)}</ul>
          <div className="lp-effort">
            <span>{t("Reasoning effort")}</span>
            <div className="lp-effort-track"><i /><b /></div>
            <div className="lp-effort-marks"><span>{t("Low")}</span><span>{t("Medium")}</span><span>{t("High")}</span></div>
          </div>
        </div>
      ),
    },
    {
      id: "search",
      size: "wide",
      title: t("Find it again, however you typed it."),
      body: t("Search runs across chats, Workspace pages and attached files. Capitals, full-width letters, hiragana or katakana: it matches them all."),
      art: (
        <div className="lp-art-search" aria-hidden="true">
          <div className="lp-search-box"><Search size={15} /><span>ｒａｙｌｅｉｇｈ</span><kbd>{t("full-width, lower-case")}</kbd></div>
          <ul>
            <li style={order(0)}><BookOpen size={14} /><div><strong>{t("Why sunsets are red")}</strong><p>{highlight(t("{term} scattering · Scattering ∝ 1/λ⁴…"), "Rayleigh")}</p></div></li>
            <li style={order(1)}><MessageSquareText size={14} /><div><strong>{t("Sunset colours")}</strong><p>{highlight(t("Both come from {term} scattering. Air scatters…"), "Rayleigh")}</p></div></li>
            <li style={order(2)}><FileText size={14} /><div><strong>{FILE_NAME}</strong><p>{highlight(t("3.2 {term} SCATTERING AND THE COLOUR OF…"), "RAYLEIGH")}</p></div></li>
          </ul>
        </div>
      ),
    },
    {
      id: "sketch",
      size: "third",
      title: t("From rough sketch to finished image."),
      body: t("Select a sketch on a whiteboard and the AI turns it into an image, right beside the original."),
      art: <div className="lp-art-sketch" aria-hidden="true"><SketchArt /><span className="lp-kind is-whiteboard"><WandSparkles size={13} />{t("Turn into image")}</span></div>,
    },
    {
      id: "characters",
      size: "third",
      title: t("Pick who keeps you company."),
      body: t("Seven characters react while you type, think and read. Or upload your own icon."),
      art: <Characters />,
    },
    {
      id: "assistant",
      size: "third",
      title: t("An assistant inside every page"),
      body: t("Ask about the page you are working on without leaving it."),
      art: (
        <div className="lp-art-assist" aria-hidden="true">
          <div className="lp-assist-page"><i /><i /><i className="is-picked" /><i /></div>
          <ul>
            <li style={order(0)}><Sparkles size={13} />{t("Improve writing")}</li>
            <li style={order(1)}>{t("Fix spelling & grammar")}</li>
            <li style={order(2)}>{t("Explain")}</li>
            <li style={order(3)}>{t("Translate")}</li>
          </ul>
          <span className="lp-assist-fab"><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={26} animated /></span>
        </div>
      ),
    },
    {
      id: "projects",
      size: "wide",
      title: t("Give related chats one home."),
      body: t("Group chats into a project, give it standing instructions, and attach the pages it should always have in mind."),
      art: (
        <div className="lp-art-project" aria-hidden="true">
          <b><Folder size={15} />{t("Physics 101")}</b>
          <p>{t("Explain with everyday examples. Quiz me at the end.")}</p>
          <ul>
            <li style={order(0)}><BookOpen size={13} />{t("Why sunsets are red")}</li>
            <li style={order(1)}><BookOpen size={13} />{t("Lens formula cheatsheet")}</li>
            <li style={order(2)}><MessageSquareText size={13} />{t("Sunset colours")}</li>
            <li style={order(3)}><MessageSquareText size={13} />{t("Why is the ocean blue?")}</li>
            <li style={order(4)}><MessageSquareText size={13} />{t("Polarised sunglasses")}</li>
          </ul>
        </div>
      ),
    },
    {
      id: "formats",
      size: "wide",
      title: t("Bring files in. Take your work out."),
      body: t("Import PDFs, PowerPoint decks and Markdown. Export to PDF, PowerPoint, PNG, SVG and Markdown."),
      art: (
        <div className="lp-art-formats" aria-hidden="true">
          <ul className="is-in">{["PDF", "PPTX", "MD"].map((name, index) => <li key={name} style={order(index)}>{name}</li>)}</ul>
          <span className="lp-formats-hub"><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={30} /></span>
          <ul className="is-out">{["PDF", "PPTX", "PNG", "SVG", "MD"].map((name, index) => <li key={name} style={order(index)}>{name}</li>)}</ul>
        </div>
      ),
    },
    {
      id: "languages",
      size: "third",
      title: t("{count} languages, light and dark.", { count: LOCALES.length }),
      body: t("Use NoteFable in your own language, including right-to-left Arabic, in the look that suits your eyes."),
      art: <LanguageRows />,
    },
    {
      id: "history",
      size: "third",
      title: t("Nothing is lost by accident."),
      body: t("Every page keeps its edit history, AI changes can be undone, and deleted pages wait in Trash for 30 days."),
      art: (
        <ul className="lp-art-history" aria-hidden="true">
          <li style={order(0)} data-current><History size={13} /><span>{t("Auto-saved")}</span><small>{t("Today")}</small></li>
          <li style={order(1)}><RotateCcw size={13} /><span>{t("Before AI edit")}</span><small className="is-action">{t("Restore")}</small></li>
          <li style={order(2)}><Trash2 size={13} /><span>{t("Trash")}</span><small>{t("{count} days left", { count: 30 })}</small></li>
        </ul>
      ),
    },
    {
      id: "share",
      size: "third",
      title: t("Share a link, not a login."),
      body: t("Publish a note, deck or whiteboard as a read-only link when someone else needs to see it."),
      art: (
        <div className="lp-art-share" aria-hidden="true">
          <span className="lp-meta"><Globe size={13} />{t("Public link")}</span>
          <div className="lp-share-url" dir="ltr"><Link2 size={14} /><span>notefable.com/s/sunset</span><b><Copy size={12} /></b></div>
          <div className="lp-share-kinds"><KindBadge kind="note">{t("Note")}</KindBadge><KindBadge kind="slides">{t("Slides")}</KindBadge><KindBadge kind="whiteboard">{t("Whiteboard")}</KindBadge></div>
        </div>
      ),
    },
  ];
}

// 紹介ページの言語メニューで選んだとき: 言語ごとの URL（/ja など）で見ているなら、アドレスもその言語の URL にする
// （共有・再読み込みで選んだ言語が出るように。/ のままなら Cookie で選ばれる）。
// Save to the account when signed in; report failures before changing the URL.
async function onLandingLocale(preference: LocalePreference, locale: Locale, isCurrent: () => boolean) {
  const error = await saveLocaleIfSignedIn(preference);
  if (error || !isCurrent()) return error;
  const path = window.location.pathname;
  if (path !== "/" && LOCALES.some((option) => path === landingPath(option))) {
    // メニューは閉じるときに、戻るキー用に積んだ履歴を戻す。戻り終えてから元の履歴の URL を書き換える。
    afterSheetHistory(() => {
      if (!isCurrent()) return;
      const url = new URL(window.location.href);
      url.pathname = preference === "auto" ? "/" : landingPath(locale);
      if (preference === "auto") url.searchParams.set("intro", "");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    });
  }
  return "";
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function LandingPage() {
  const t = useT();
  // タブのタイトルはメタデータ（[locale]/page.tsx）と同じ英語のヒーロー見出しに揃える。
  useEffect(() => { document.title = landingTitle(); }, [t]);
  const { options: modelOptions, defaultModel } = useModels();
  const modelLabel = modelOptions.find((model) => model.id === defaultModel)?.label ?? modelOptions[0].label;
  const steps = useSteps(t);
  const features = useFeatures(t);
  const pageRef = useRef<HTMLDivElement>(null);
  // 流れの見本の状態。null は JS が動く前（全部を出したままにする）。
  // active：広い画面でいま見せている段（狭い画面は -1 で、全部を見せる）。live：中身の動きを始めた段。motion：動きを減らす設定でないか。
  const [flowState, setFlowState] = useState<{ active: number; live: boolean[]; motion: boolean } | null>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // landing.css の「広い画面」と同じ条件。横長でも背の低い画面（横向きのスマホ）は、見本が画面に収まらないので縦に並べる。
    const wide = window.matchMedia("(min-width: 900px) and (min-height: 640px)");
    const nav = page.querySelector<HTMLElement>(".lp-nav");
    const hero = page.querySelector<HTMLElement>(".lp-hero");
    const stage = page.querySelector<HTMLElement>(".lp-stage");
    const flow = page.querySelector<HTMLElement>(".lp-flow-grid");
    const copies = Array.from(page.querySelectorAll<HTMLElement>(".lp-flow-copy"));
    const panels = Array.from(page.querySelectorAll<HTMLElement>(".lp-flow-panel"));
    page.classList.add("lp-js");
    if (!still) page.classList.add("lp-anim");

    let frame = 0;
    // null は「まだ一度も決めていない」。最初の 1 回は必ず状態に入れる（全部が画面の外でも、見本を待機に戻すため）。
    let current: { active: number; live: boolean[] } | null = null;
    let stuck: boolean | null = null;
    let lift = "";
    let fill = "";
    const update = () => {
      frame = 0;
      // 先に位置をすべて読み、あとでまとめて書く（読み書きを交互にすると、毎フレーム配置を計算し直させてしまう）。
      const height = window.innerHeight;
      const top = page.scrollTop;
      const heroHeight = hero?.offsetHeight ?? 0;
      let active = -1;
      let live: boolean[];
      let nextFill = fill;
      if (wide.matches) {
        // 広い画面：画面の中ほどに一番近い段を見せる（右の見本は一つの枠で入れ替わる）。
        const centres = copies.map((copy) => { const rect = copy.getBoundingClientRect(); return rect.top + rect.height / 2; });
        const focus = height * 0.5;
        active = centres.reduce((best, centre, index) => Math.abs(centre - focus) < Math.abs(centres[best] - focus) ? index : best, 0);
        // 中身の動きは、流れの区画が画面に入ってから始める（画面の外で先に動き終わらないように）。見せる段の選択とは別に決める。
        const area = flow?.getBoundingClientRect();
        const inView = still || !area || (area.top < height * 0.62 && area.bottom > height * 0.3);
        const before = current;
        live = copies.map((_, index) => index === active && (inView || Boolean(before?.active === active && before.live[index])));
        nextFill = clamp((focus - centres[0]) / Math.max(1, centres[centres.length - 1] - centres[0])).toFixed(3);
      } else {
        // 狭い画面：見本は縦に並ぶ。一度見えた見本は動かしたままにする。
        const before = current;
        live = panels.map((panel, index) => Boolean(before?.live[index]) || panel.getBoundingClientRect().top < height * 0.78);
      }

      if (stuck !== top > 16) { stuck = top > 16; nav?.toggleAttribute("data-stuck", stuck); }
      // 舞台はスクロールにつれて起き上がり、平らになる。
      const nextLift = clamp(top / Math.max(1, heroHeight * 0.55)).toFixed(3);
      if (stage && !still && nextLift !== lift) { lift = nextLift; stage.style.setProperty("--sp", lift); }
      if (nextFill !== fill) { fill = nextFill; flow?.style.setProperty("--fp", fill); }
      const previous = current;
      if (!previous || previous.active !== active || live.some((value, index) => value !== previous.live[index])) {
        current = { active, live };
        setFlowState({ active, live, motion: !still });
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    // 画面に入った要素を一度だけ現す。
    const seen = still ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        seen?.unobserve(entry.target);
      }
    }, { root: page, rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    const revealed = Array.from(page.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (seen) revealed.forEach((element) => seen.observe(element)); else revealed.forEach((element) => element.classList.add("is-in"));

    // ポインターに合わせて舞台が少し傾き、カードの縁が光る。
    const fine = !still && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    // ポインターの動きは 1 フレームに 1 回だけ反映する。
    let pointerFrame = 0;
    let heroPoint: { x: number; y: number } | null = null;
    let glowPoint: { x: number; y: number; card: HTMLElement } | null = null;
    const applyPointer = () => {
      pointerFrame = 0;
      if (heroPoint && stage && hero) {
        const rect = hero.getBoundingClientRect();
        stage.style.setProperty("--px", ((heroPoint.x - rect.left) / Math.max(1, rect.width) - 0.5).toFixed(3));
        stage.style.setProperty("--py", ((heroPoint.y - rect.top) / Math.max(1, rect.height) - 0.5).toFixed(3));
      }
      if (glowPoint) {
        const rect = glowPoint.card.getBoundingClientRect();
        glowPoint.card.style.setProperty("--mx", `${glowPoint.x - rect.left}px`);
        glowPoint.card.style.setProperty("--my", `${glowPoint.y - rect.top}px`);
      }
      heroPoint = null;
      glowPoint = null;
    };
    const onHeroMove = (event: PointerEvent) => {
      heroPoint = { x: event.clientX, y: event.clientY };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointer);
    };
    const onGlow = (event: PointerEvent) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(".lp-cell");
      if (!card) return;
      glowPoint = { x: event.clientX, y: event.clientY, card };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointer);
    };
    const bento = page.querySelector<HTMLElement>(".lp-bento");
    if (fine) {
      hero?.addEventListener("pointermove", onHeroMove, { passive: true });
      bento?.addEventListener("pointermove", onGlow, { passive: true });
    }

    update();
    page.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    wide.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pointerFrame);
      seen?.disconnect();
      page.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      wide.removeEventListener("change", schedule);
      hero?.removeEventListener("pointermove", onHeroMove);
      bento?.removeEventListener("pointermove", onGlow);
      page.classList.remove("lp-js", "lp-anim");
    };
  }, []);

  // 見出しは単語ごとに立ち上がる。単語の間の空白は残す（読み上げと折り返しのため）。
  const leadWords = LANDING_HERO.headlineLead.split(" ");
  const tailWords = LANDING_HERO.headlineTail.split(" ");
  const words = (texts: string[], start: number) => texts.flatMap((text, index) => [
    index ? " " : null,
    <span className="lp-word" style={order(start + index)} key={index}>{text}</span>,
  ]);

  return (
    <div className="lp-page" ref={pageRef}>
      <a className="lp-skip" href="#lp-main">{t("Skip to content")}</a>

      <header className="lp-nav">
        <div className="lp-nav-bar">
          <Link className="lp-brand" href={INTRO_HREF} aria-label={t("NoteFable home")}><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={24} /><span>NoteFable</span></Link>
          <nav aria-label={t("Sections")}>
            <a href="#lp-flow">{t("How it works")}</a>
            <a href="#lp-features">{t("Features")}</a>
          </nav>
          <Link className="lp-nav-cta" href="/app" prefetch={false}>{t("Open NoteFable")}<ArrowRight size={15} aria-hidden="true" className="rtl-mirror" /></Link>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-aurora" aria-hidden="true"><i /><i /><i /></div>
          <div className="lp-wrap">
            <p className="lp-eyebrow" lang="en" dir="ltr"><Sparkles size={14} aria-hidden="true" />{LANDING_HERO.eyebrow}</p>
            <h1 id="lp-title" lang="en" dir="ltr">
              <span className="lp-line">{words(leadWords, 0)}</span>{" "}
              <span className="lp-line">{words(tailWords, leadWords.length)}{" "}<span className="lp-word lp-grad" style={order(leadWords.length + tailWords.length)}>{LANDING_HERO.headlineMark}</span></span>
            </h1>
            <p className="lp-lede" lang="en" dir="ltr">{LANDING_HERO.lede}</p>
            <div className="lp-hero-cta">
              <Link className="lp-btn is-primary" href="/app" prefetch={false}>{t("Open NoteFable")}<ArrowRight size={17} aria-hidden="true" className="rtl-mirror" /></Link>
              <a className="lp-btn" href="#lp-flow">{t("See how it works")}<ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <p className="lp-hero-note">{t("Free to start. No account needed.")}</p>
            <HeroStage t={t} modelLabel={modelLabel} />
          </div>
        </section>

        <section className="lp-flow lp-wrap" id="lp-flow" aria-labelledby="lp-flow-title">
          <header className="lp-head" data-reveal>
            <p className="lp-kicker">{t("How it works")}</p>
            <h2 id="lp-flow-title">{t("One question, all the way through.")}</h2>
            <p>{t("Follow a single question from the first answer to notes, slides and a quiz.")}</p>
          </header>
          <div className="lp-flow-grid">
            <div className="lp-flow-rail" aria-hidden="true"><i /></div>
            {steps.map((step, index) => {
              // on：この段を見せるか（広い画面で一つを選ぶ）。live：中身の動きを始めたか。JS が動く前はどちらも true。
              const on = !flowState || flowState.active < 0 || flowState.active === index;
              const live = flowState ? flowState.live[index] : true;
              return (
                <div className="lp-flow-step" key={step.id} style={order(index)}>
                  <div className="lp-flow-copy" data-on={on}>
                    <span className="lp-step-no"><b>{String(index + 1).padStart(2, "0")}</b>{step.label}</span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                  {/* 広い画面では 4 つの見本が同じ枠に重なり、いまの段のものだけが見える。飾りの見本なので読み上げは本文に任せる。 */}
                  <div className={`lp-flow-panel is-${step.id}`} data-on={on} data-live={live} aria-hidden="true">
                    <div className="lp-win">{step.panel(live, Boolean(flowState?.motion))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lp-features lp-wrap" id="lp-features" aria-labelledby="lp-features-title">
          <header className="lp-head" data-reveal>
            <p className="lp-kicker">{t("Features")}</p>
            <h2 id="lp-features-title">{t("More than a chat window.")}</h2>
            <p>{t("Everything you make lives in one Workspace, ready for the next question.")}</p>
          </header>
          <ul className="lp-bento">
            {features.map((feature, index) => (
              <li className={`lp-cell is-${feature.size} is-${feature.id}`} key={feature.id} data-reveal style={order(index % 3)}>
                <div className="lp-cell-art">{feature.art}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-wrap" aria-labelledby="lp-finale-title">
          <div className="lp-finale" data-reveal>
            <div className="lp-finale-sky" aria-hidden="true"><i /><i /><i /></div>
            <div className="lp-finale-face"><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={112} hero animated /></div>
            <h2 id="lp-finale-title">{t("What is the question you keep coming back to?")}</h2>
            <Link className="lp-btn is-light" href="/app" prefetch={false}>{t("Open NoteFable")}<ArrowRight size={17} aria-hidden="true" className="rtl-mirror" /></Link>
            <ul className="lp-finale-facts">
              <li><Check size={14} aria-hidden="true" />{t("No account needed")}</li>
              <li><Check size={14} aria-hidden="true" />{t("Google or email sign-in, if you want it")}</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-wrap">
        <span className="lp-brand"><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={20} /><span>NoteFable</span></span>
        <div className="lp-footer-end">
          <LanguageMenu className="lp-language" onChoose={onLandingLocale} />
          <nav aria-label={t("Legal")}><Link href="/privacy">{t("Privacy")}</Link><Link href="/terms">{t("Terms")}</Link><Link href="/legal-notice">{t("Commercial disclosure")}</Link></nav>
        </div>
      </footer>
    </div>
  );
}
