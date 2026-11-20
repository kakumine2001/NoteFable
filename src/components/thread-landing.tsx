"use client";

import {
  ArrowRight, ArrowUp, BookOpen, Copy, FileText, Folder, Globe, History,
  MessageSquareText, MoreHorizontal, NotebookPen, Paperclip, Plus, Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LanguageMenu } from "@/components/language-menu";
import { useModels } from "@/components/models-provider";
import { CharacterGraphic } from "@/components/character-avatar";
import { DEFAULT_CHARACTER_ID } from "@/lib/characters";
import { LOCALES, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { LANDING_HERO, landingTitle } from "@/lib/i18n/landing-meta";
import { INTRO_HREF, landingPath } from "@/lib/i18n/routing";
import { saveLocaleIfSignedIn } from "@/lib/account-store";
import { afterSheetHistory } from "@/lib/use-back-to-close";
import { useT } from "@/components/i18n-provider";

// 同じ問いを英語・中国語・日本語で打ち直す。ページ全体がこの一つの問いを追いかける。
const QUESTIONS = [
  "Why is the sunset red if the sky is blue?",
  "为什么天空是蓝的，晚霞却是红的？",
  "空は青いのに、夕焼けはなぜ赤い？",
  "Explain Rayleigh scattering like I'm twelve.",
];


// 打鍵ごとの再レンダーをこの小さな部品に閉じ込める。
function TypedQuestion() {
  const [text, setText] = useState(QUESTIONS[0]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0;
    let chars = Array.from(QUESTIONS[0]);
    let shown = chars.length;
    let erasing = true;
    let timer = window.setTimeout(step, 2800);

    function step() {
      let delay: number;
      if (erasing) {
        shown = Math.max(0, shown - 2);
        delay = 16;
        if (shown === 0) {
          index = (index + 1) % QUESTIONS.length;
          chars = Array.from(QUESTIONS[index]);
          erasing = false;
          delay = 380;
        }
      } else {
        shown += 1;
        // 漢字・かなは 1 文字の情報量が多いので、少しゆっくり打つ。
        delay = chars[shown - 1].charCodeAt(0) > 0x2e7f ? 85 : 36;
        if (shown === chars.length) {
          erasing = true;
          delay = 2800;
        }
      }
      setText(chars.slice(0, shown).join(""));
      timer = window.setTimeout(step, delay);
    }

    return () => window.clearTimeout(timer);
  }, []);

  return <>{text}<i className="tl-caret" /></>;
}

// 回答が流れてくる様子を、単語ごとの遅延で表す。
function stream(text: string, emphasis: string) {
  // 訳文全体で語順を決めてから、強調する語だけを差し込む。
  const parts: Array<string | { strong: string }> = text.split("{term}").flatMap((part, index) =>
    index ? [{ strong: emphasis }, part] : [part]);
  let count = 0;
  return parts.flatMap((part, partIndex) => {
    const strong = typeof part !== "string";
    // 空白で区切る言語は単語ごと、中国語・日本語は読点・句点ごとに流す（区切りの文字は各片に残す）。
    return ((strong ? part.strong : part).match(/[^\s，。、！？]*[，。、！？]*\s*/g) ?? []).filter(Boolean).map((word, wordIndex) => {
      const style = { "--i": count++ } as React.CSSProperties;
      const key = `${partIndex}-${wordIndex}`;
      return strong
        ? <strong className="tl-word" style={style} key={key}>{word}</strong>
        : <span className="tl-word" style={style} key={key}>{word}</span>;
    });
  });
}

function searchExcerpt(text: string, term: string) {
  return text.split("{term}").flatMap((part, index) =>
    index ? [<mark key={index}>{term}</mark>, part] : [part]);
}

type Station = { id: string; label: string; title: string; body: string; card: ReactNode };

function useStations(): Station[] {
  const t = useT();
  const { options: modelOptions, defaultModel } = useModels();
  return [
  {
    id: "ask",
    label: t("Ask"),
    title: t("Start with whatever you have."),
    body: t("A question, a PDF, a screenshot, half a sentence. Choose the model that suits it and how hard it should think."),
    card: (
      <div className="tl-card tl-card-ask">
        <p className="tl-bubble">{t("Why is the sunset red if the sky is blue?")}</p>
        <span className="tl-file"><Paperclip size={13} />{" "}optics-ch3.pdf</span>
        <ul className="tl-models" aria-label={t("Available models")}>
          {modelOptions.map((model) => <li key={model.id} data-current={model.id === defaultModel || undefined}>{model.label}</li>)}
        </ul>
      </div>
    ),
  },
  {
    id: "understand",
    label: t("Understand"),
    title: t("Get an answer you can push on."),
    body: t("Follow up, ask for another angle, or let it search the web and show its sources. Switch to image mode when a picture explains it better."),
    card: (
      <div className="tl-card tl-card-answer">
        <span className="tl-card-meta"><Globe size={13} />{" "}{t("Searched the web · 3 sources")}</span>
        <p>{stream(t("Both come from {term}. Air scatters short blue wavelengths the most, so at noon blue reaches you from every direction. At sunset the light crosses far more air, the blue is scattered away, and red is what is left."), t("Rayleigh scattering"))}</p>
        <div className="tl-actions">
          <span><Copy size={13} />{" "}{t("Copy")}</span>
          <span className="tl-action-save"><NotebookPen size={13} />{" "}{t("Save to Notes")}</span>
          <span aria-hidden="true"><MoreHorizontal size={15} /></span>
        </div>
      </div>
    ),
  },
  {
    id: "keep",
    label: t("Keep"),
    title: t("Save the part worth keeping."),
    body: t("One click turns an answer into a note you can edit. Every note keeps its edit history, and deleted notes wait in Trash for 30 days."),
    card: (
      <div className="tl-card tl-card-note">
        <span className="tl-note-emoji" aria-hidden="true">🌅</span>
        <h4>{t("Why sunsets are red")}</h4>
        <h5>{t("Rayleigh scattering")}</h5>
        <ul>
          <li>{t("Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red")}</li>
          <li>{t("Noon: short path, blue from everywhere")}</li>
          <li>{t("Sunset: long path, blue removed, red remains")}</li>
        </ul>
        <p className="tl-note-own">{t("In my own words: the sky keeps the blue for itself")}<i aria-hidden="true" /></p>
        <span className="tl-card-meta"><History size={13} />{" "}{t("Saved · history kept")}</span>
      </div>
    ),
  },
  {
    id: "connect",
    label: t("Connect"),
    title: t("Give related chats one home."),
    body: t("Group chats into a project, give it standing instructions, and attach the notes it should always have in mind."),
    card: (
      <div className="tl-card tl-card-project">
        <h4><Folder size={16} />{" "}{t("Physics 101")}</h4>
        <dl>
          <dt>{t("Instructions")}</dt>
          <dd className="tl-project-quote">{t("Explain with everyday examples. Quiz me at the end.")}</dd>
          <dt>{t("Reference notes")}</dt>
          <dd><span><BookOpen size={13} />{" "}{t("Why sunsets are red")}</span><span><BookOpen size={13} />{" "}{t("Lens formula cheatsheet")}</span></dd>
          <dt>{t("Chats")}</dt>
          <dd><span><MessageSquareText size={13} />{" "}{t("Sunset colours")}</span><span><MessageSquareText size={13} />{" "}{t("Why is the ocean blue?")}</span><span><MessageSquareText size={13} />{" "}{t("Polarised sunglasses")}</span></dd>
        </dl>
      </div>
    ),
  },
  {
    id: "find",
    label: t("Find"),
    title: t("Find it again, however you typed it."),
    body: t("Search runs across chats, notes and attached files. Capitals, full-width letters, hiragana or katakana: it matches them all."),
    card: (
      <div className="tl-card tl-card-search">
        <div className="tl-search-box"><Search size={15} /><span>ｒａｙｌｅｉｇｈ</span><kbd>{t("full-width, lower-case")}</kbd></div>
        <ul>
          <li><BookOpen size={14} /><div><strong>{t("Why sunsets are red")}</strong><p>{searchExcerpt(t("{term} scattering · Scattering ∝ 1/λ⁴…"), "Rayleigh")}</p></div></li>
          <li><MessageSquareText size={14} /><div><strong>{t("Sunset colours")}</strong><p>{searchExcerpt(t("Both come from {term} scattering. Air scatters…"), "Rayleigh")}</p></div></li>
          <li><FileText size={14} /><div><strong>optics-ch3.pdf</strong><p>{searchExcerpt(t("3.2 {term} SCATTERING AND THE COLOUR OF…"), "RAYLEIGH")}</p></div></li>
        </ul>
      </div>
    ),
  },
  ];
}

function useFacts() {
  const t = useT();
  return [
  { title: t("No account needed"), body: t("Open it and start. Your chats and notes are tied to this browser.") },
  { title: t("Google sign-in, if you want it"), body: t("Sign in to carry the same chats and notes to another device.") },
  { title: t("An assistant inside every note"), body: t("Ask about the page you are writing without leaving it.") },
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

export function ThreadLanding() {
  const t = useT();
  // タブのタイトルはメタデータ（[locale]/page.tsx）と同じ英語のヒーロー見出しに揃える。
  useEffect(() => { document.title = landingTitle(); }, [t]);
  const { options: modelOptions, defaultModel } = useModels();
  const defaultModelLabel = modelOptions.find((model) => model.id === defaultModel)?.label ?? modelOptions[0].label;
  const STATIONS = useStations();
  const FACTS = useFacts();
  const journeyRef = useRef<HTMLOListElement>(null);

  // 糸はスクロール位置まで伸びる。各区間の進み具合を CSS 変数で渡し、再レンダーはしない。
  useEffect(() => {
    const journey = journeyRef.current;
    const scroller = journey?.closest<HTMLElement>(".tl-page");
    if (!journey || !scroller) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rails = Array.from(journey.querySelectorAll<HTMLElement>(".tl-rail"));
    journey.classList.add("tl-live");
    let frame = 0;
    // --node-y はブレークポイントでしか変わらないので、リサイズ時だけ読み直す。
    let nodeY = 0;
    const measure = () => { nodeY = parseFloat(getComputedStyle(rails[0]).getPropertyValue("--node-y")) || 0; };

    const update = () => {
      frame = 0;
      // 背の高い画面では最後の停留所が基準線に届かないまま末尾に着くので、末尾では全部を見せる。
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const trigger = atEnd ? Infinity : window.innerHeight * 0.64;
      for (const rail of rails) {
        const rect = rail.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (trigger - rect.top - nodeY) / rect.height));
        rail.style.setProperty("--p", progress.toFixed(4));
        // 糸の先端の光点。曲線 x(t) = 50 ± 180·t(1−t) を、y がほぼ t に比例することを使って追う。
        const side = rail.dataset.side === "left" ? -1 : 1;
        rail.style.setProperty("--x", (50 + side * 180 * progress * (1 - progress)).toFixed(2));
        rail.classList.toggle("is-drawing", progress > 0 && progress < 1);
        if (progress > 0) rail.parentElement?.classList.add("is-on");
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    const onResize = () => { measure(); schedule(); };
    measure();
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      journey.classList.remove("tl-live");
    };
  }, []);

  return (
    <div className="tl-page">
      <a className="tl-skip" href="#tl-main">{t("Skip to content")}</a>

      <header className="tl-nav tl-wrap">
        <Link className="tl-brand" href={INTRO_HREF} aria-label={t("NoteFable home")}><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={26} /><span>NoteFable</span></Link>
        <Link className="tl-nav-cta" href="/app" prefetch={false}>{t("Open workspace")}{" "}<ArrowRight size={15} aria-hidden="true" /></Link>
      </header>

      <main id="tl-main">
        <section
          className="tl-hero"
          aria-labelledby="tl-title"
          onPointerMove={(event) => {
            // 方眼の点がカーソルの周りだけ濃くなる。
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
            event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
          }}
        >
          <div className="tl-hero-glow" aria-hidden="true" />
          <div className="tl-wrap">
            <p className="tl-kicker" lang="en" dir="ltr">{LANDING_HERO.eyebrow}</p>
            <h1 id="tl-title" lang="en" dir="ltr"><span className="tl-rise">{LANDING_HERO.headlineLead}</span> <span className="tl-rise"><span className="tl-mark">{LANDING_HERO.headlineMark}</span></span><br /><span className="tl-rise">{LANDING_HERO.headlineTail}</span></h1>
            <p className="tl-lede" lang="en" dir="ltr">{LANDING_HERO.lede}</p>

            <Link className="tl-composer" href="/app" prefetch={false} aria-label={t("Open NoteFable and ask a question")}>
              <span className="tl-composer-text" aria-hidden="true"><TypedQuestion /></span>
              <span className="tl-composer-bar" aria-hidden="true">
                <span className="tl-composer-plus"><Plus size={17} /></span>
                <span className="tl-composer-model">{defaultModelLabel}</span>
                <span className="tl-composer-send"><ArrowUp size={17} /></span>
              </span>
            </Link>
            <p className="tl-hero-note">{t("Click the box to start. No account needed.")}</p>
            <div className="tl-stem" aria-hidden="true" />
          </div>
        </section>

        <section className="tl-journey-section tl-wrap" aria-labelledby="tl-journey-title">
          <h2 id="tl-journey-title" className="tl-sr">{t("How one question travels through NoteFable")}</h2>
          <ol className="tl-journey" ref={journeyRef}>
            {STATIONS.map((station, index) => (
              <li className="tl-station" key={station.id}>
                <div className="tl-rail" aria-hidden="true" data-side={index % 2 ? "left" : "right"}>
                  <span className="tl-node" />
                  {index < STATIONS.length - 1 && (
                    <div className="tl-seg">
                      {["tl-seg-track", "tl-seg-fill"].map((name) => (
                        <svg key={name} className={name} viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
                          <path d={index % 2 ? "M50 0C-10 33-10 67 50 100" : "M50 0C110 33 110 67 50 100"} vectorEffect="non-scaling-stroke" />
                        </svg>
                      ))}
                      <span className="tl-spark" />
                    </div>
                  )}
                </div>
                <div className="tl-copy">
                  <span className="tl-step"><b>{String(index + 1).padStart(2, "0")}</b> {station.label}</span>
                  <h3>{station.title}</h3>
                  <p>{station.body}</p>
                </div>
                <div className="tl-card-slot">{station.card}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="tl-facts tl-wrap" aria-label={t("Good to know")}>
          {FACTS.map((fact) => <div key={fact.title}><h3>{fact.title}</h3><p>{fact.body}</p></div>)}
        </section>

        <section className="tl-wrap" aria-labelledby="tl-finale-title">
          <div className="tl-finale">
            <h2 id="tl-finale-title">{t("What is the question you keep coming back to?")}</h2>
            <Link className="tl-finale-cta" href="/app" prefetch={false}>{t("Open NoteFable")}{" "}<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="tl-footer tl-wrap">
        <span className="tl-brand"><CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={20} /><span>NoteFable</span></span>
        <div className="tl-footer-end">
          <LanguageMenu className="tl-language" onChoose={onLandingLocale} />
          <nav aria-label={t("Legal")}><Link href="/privacy">{t("Privacy")}</Link><Link href="/terms">{t("Terms")}</Link><Link href="/legal-notice">{t("Commercial disclosure")}</Link></nav>
        </div>
      </footer>
    </div>
  );
}
