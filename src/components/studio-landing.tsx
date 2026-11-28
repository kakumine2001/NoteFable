"use client";

import {
  ArrowDown, ArrowRight, BookOpen, Globe, Moon, Presentation, Shapes, ShieldCheck,
  Smartphone, Sparkles, Sun,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type PointerEvent } from "react";
import { CharacterGraphic } from "@/components/character-avatar";
import { useT } from "@/components/i18n-provider";
import {
  BentoNotesPreview,
  BentoSlidesPreview,
  BentoWhiteboardPreview,
  CompanionsShowcase,
  ConnectedWorkspaceVisual,
  HeroStudioStage,
  HybridSearchDemo,
  ModelReasoningEngine,
  ProjectContextStrip,
  ProposalSandbox,
  ReviewQuizWidget,
} from "@/components/landing-demos";
import { LanguageMenu } from "@/components/language-menu";
import { saveLocaleIfSignedIn } from "@/lib/account-store";
import { DEFAULT_CHARACTER_ID } from "@/lib/characters";
import { LANDING_HERO, landingTitle } from "@/lib/i18n/landing-meta";
import { LOCALES, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { INTRO_HREF, landingPath } from "@/lib/i18n/routing";
import { useTheme } from "@/lib/theme";
import { afterSheetHistory } from "@/lib/use-back-to-close";

// 紹介ページの言語メニューで選んだとき: 言語ごとの URL（/ja など）で見ているなら、アドレスもその言語の URL にする
// （共有・再読み込みで選んだ言語が出るように。/ のままなら Cookie で選ばれる）。
// Save to the account when signed in; report failures before changing the URL.
async function onLandingLocale(preference: LocalePreference, locale: Locale, isCurrent: () => boolean) {
  const error = await saveLocaleIfSignedIn(preference);
  if (error || !isCurrent()) return error;
  const path = window.location.pathname;
  if (path !== "/" && LOCALES.some((option) => path === landingPath(option))) {
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

function handleCardSpotlight(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--cx", `${(event.clientX - rect.left).toFixed(1)}px`);
  event.currentTarget.style.setProperty("--cy", `${(event.clientY - rect.top).toFixed(1)}px`);
}

export function StudioLanding() {
  const t = useT();
  const { resolved, setPreference } = useTheme();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const navOuterRef = useRef<HTMLElement>(null);
  const heroStageRef = useRef<HTMLDivElement>(null);

  // タブのタイトルはメタデータ（[locale]/page.tsx）と同じ英語のヒーロー見出しに揃える。
  useEffect(() => {
    document.title = landingTitle();
  }, [t]);

  // スクロールに応じた浮遊ナビバー・ステージの立体傾き・各セクションの出現アニメーション。
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.from(scroller.querySelectorAll<HTMLElement>("[data-reveal]"));
    let frame = 0;

    const revealVisible = () => {
      const limit = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.96;
      for (const el of targets) {
        if (el.getAttribute("data-visible") === "true") continue;
        if (el.getBoundingClientRect().top <= limit) {
          el.setAttribute("data-visible", "true");
        }
      }
    };

    const syncNavAndReveal = () => {
      const top = scroller.scrollTop;
      if (navOuterRef.current) {
        if (top > 6) navOuterRef.current.setAttribute("data-scrolled", "true");
        else navOuterRef.current.removeAttribute("data-scrolled");
      }
      if (!reducedMotion) revealVisible();
    };

    const updateTilt = () => {
      frame = 0;
      if (!reducedMotion && heroStageRef.current) {
        // 0 → 320px のスクロールで微妙な傾き（5.5deg → 0deg）とスケール（0.978 → 1）を滑らかに起こす。
        const progress = Math.min(1, Math.max(0, scroller.scrollTop / 320));
        heroStageRef.current.style.setProperty("--tilt", `${((1 - progress) * 5.5).toFixed(2)}deg`);
        heroStageRef.current.style.setProperty("--stage-scale", `${(0.978 + progress * 0.022).toFixed(4)}`);
      }
    };

    const onScroll = () => {
      syncNavAndReveal();
      if (!frame) frame = window.requestAnimationFrame(updateTilt);
    };

    let observer: IntersectionObserver | null = null;
    if (!reducedMotion && typeof IntersectionObserver !== "undefined") {
      scroller.classList.add("lp-ready");
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.setAttribute("data-visible", "true");
              observer?.unobserve(entry.target);
            }
          }
        },
        { root: scroller, rootMargin: "0px 0px -4% 0px", threshold: 0.05 },
      );
      for (const el of targets) observer.observe(el);
    }

    syncNavAndReveal();
    updateTilt();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer?.disconnect();
      scroller.classList.remove("lp-ready");
    };
  }, []);

  const isDark = resolved === "dark";
  const toggleTheme = () => setPreference(isDark ? "light" : "dark");

  return (
    <div className="lp-page" ref={scrollerRef}>
      <a className="lp-skip" href="#lp-main">{t("Skip to content")}</a>

      <header className="lp-nav-outer" ref={navOuterRef}>
        <div className="lp-nav">
          <Link className="lp-brand" href={INTRO_HREF} aria-label={t("NoteFable home")}>
            <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={26} />
            <span>NoteFable</span>
          </Link>

          <nav className="lp-nav-links" aria-label={t("Main navigation")}>
            <a href="#workspace">{t("Workspace")}</a>
            <a href="#co-creation">{t("AI Co-Creation")}</a>
            <a href="#study-recall">{t("Study & Recall")}</a>
            <a href="#companions">{t("Companions")}</a>
          </nav>

          <div className="lp-nav-actions">
            <button
              type="button"
              className="lp-theme-btn"
              onClick={toggleTheme}
              aria-label={isDark ? t("Switch to light mode") : t("Switch to dark mode")}
              title={isDark ? t("Light") : t("Dark")}
            >
              {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <Link className="lp-nav-cta" href="/app" prefetch={false}>
              <span>{t("Open NoteFable")}</span>
              <ArrowRight size={15} className="rtl-mirror" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main id="lp-main">
        {/* Act I: Kinetic Hero + Interactive Split-Screen Studio */}
        <section
          className="lp-hero"
          aria-labelledby="lp-title"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty("--mx", `${(event.clientX - rect.left).toFixed(1)}px`);
            event.currentTarget.style.setProperty("--my", `${(event.clientY - rect.top).toFixed(1)}px`);
          }}
        >
          <div className="lp-hero-aurora" aria-hidden="true" />
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-hero-glow" aria-hidden="true" />

          <div className="lp-wrap lp-hero-inner">
            <p className="lp-eyebrow" lang="en" dir="ltr">
              <i className="lp-eyebrow-dot" aria-hidden="true" />
              <span>{LANDING_HERO.eyebrow}</span>
            </p>

            <h1 id="lp-title" lang="en" dir="ltr">
              <span className="lp-rise">{LANDING_HERO.headlineLead}</span>{" "}
              <span className="lp-rise">
                <span className="lp-mark">{LANDING_HERO.headlineMark}</span>
              </span>
              <br />
              <span className="lp-rise">{LANDING_HERO.headlineTail}</span>
            </h1>

            <p className="lp-lede" lang="en" dir="ltr">{LANDING_HERO.lede}</p>

            <div className="lp-hero-ctas">
              <Link className="lp-cta-primary" href="/app" prefetch={false}>
                <span>{t("Open NoteFable")}</span>
                <ArrowRight size={16} className="rtl-mirror" aria-hidden="true" />
              </Link>
              <a className="lp-cta-secondary" href="#workspace">
                <span>{t("Explore the Workspace")}</span>
                <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>

            <p className="lp-hero-reassurance">{t("No account needed · Web, Android & iOS")}</p>

            <div className="lp-hero-stage-wrap" ref={heroStageRef}>
              <HeroStudioStage />
            </div>
          </div>
        </section>

        {/* Act II: Three Canvases, One Workspace (Bento Grid) */}
        <section id="workspace" className="lp-section lp-wrap" aria-labelledby="lp-workspace-title">
          <div className="lp-section-head" data-reveal="">
            <span className="lp-kicker">{t("Workspace")}</span>
            <h2 id="lp-workspace-title">{t("Three canvases, one Workspace.")}</h2>
            <p>{t("Write structured notes, sketch freely on infinite whiteboards, and build presentation decks—all linked together.")}</p>
          </div>

          <div className="lp-bento">
            <article className="lp-card lp-bento-wide" data-kind="notes" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <span className="lp-kind-pill" data-kind="notes"><BookOpen size={14} aria-hidden="true" /> {t("Notes")}</span>
                <p>{t("Structured block editor with math, code, backlinks, Markdown import and one-click presentation.")}</p>
              </div>
              <BentoNotesPreview />
            </article>

            <article className="lp-card lp-bento-narrow" data-kind="whiteboards" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <span className="lp-kind-pill" data-kind="whiteboards"><Shapes size={14} aria-hidden="true" /> {t("Whiteboards")}</span>
                <p>{t("Infinite canvas with mind maps, study templates, PDF markup, diagrams from AI and sketch-to-image.")}</p>
              </div>
              <BentoWhiteboardPreview />
            </article>

            <article className="lp-card lp-bento-half" data-kind="slides" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <span className="lp-kind-pill" data-kind="slides"><Presentation size={14} aria-hidden="true" /> {t("Slides")}</span>
                <p>{t("Layouts, themes, PowerPoint import and export, speaker notes and full-screen presenter view.")}</p>
              </div>
              <BentoSlidesPreview />
            </article>

            <article className="lp-card lp-bento-half" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <h3>{t("Everything stays connected.")}</h3>
                <p>{t("Embed live whiteboards inside notes and slides, link pages with @, share read-only links, and recover edits from version history or 30-day Trash.")}</p>
              </div>
              <ConnectedWorkspaceVisual />
            </article>
          </div>
        </section>

        {/* Act III: AI Co-Creation */}
        <section id="co-creation" className="lp-section lp-wrap" aria-labelledby="lp-ai-title">
          <div className="lp-section-head" data-reveal="">
            <span className="lp-kicker"><Sparkles size={13} aria-hidden="true" /> {t("AI Co-Creation")}</span>
            <h2 id="lp-ai-title">{t("AI that builds with you, never behind your back.")}</h2>
            <p>{t("Generate a note, whiteboard or slide deck from any topic, or let AI propose edits with a clear preview before anything changes.")}</p>
          </div>

          <div className="lp-two-col">
            <article className="lp-card" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <h3>{t("Edit proposals with one-click undo")}</h3>
                <p>{t("Review changes to notes, whiteboards or slides before applying—or enable auto-apply inside a page.")}</p>
              </div>
              <ProposalSandbox />
            </article>

            <article className="lp-card" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <h3>{t("Multiple models, adjustable thinking")}</h3>
                <p>{t("Pick the right model for the task and dial reasoning depth up or down. Automatic web search, vision and long-context compaction included.")}</p>
              </div>
              <ModelReasoningEngine />
            </article>
          </div>

          <div className="lp-card lp-project-card" data-reveal="" onPointerMove={handleCardSpotlight}>
            <ProjectContextStrip />
          </div>
        </section>

        {/* Act IV: Study & Recall */}
        <section id="study-recall" className="lp-section lp-wrap" aria-labelledby="lp-study-title">
          <div className="lp-section-head" data-reveal="">
            <span className="lp-kicker">{t("Study & Recall")}</span>
            <h2 id="lp-study-title">{t("Turn notes into active recall. Find anything instantly.")}</h2>
            <p>{t("Generate practice quizzes and flashcards directly from your notes and slides, and search everything by keyword or meaning.")}</p>
          </div>

          <div className="lp-two-col">
            <article className="lp-card" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <h3>{t("Quiz me")} &amp; {t("Flashcards")}</h3>
                <p>{t("Tap card to flip")}</p>
              </div>
              <ReviewQuizWidget />
            </article>

            <article className="lp-card" data-reveal="" onPointerMove={handleCardSpotlight}>
              <div className="lp-card-head">
                <h3>{t("Semantic + spelling-folded search")}</h3>
                <p>{t("Matches full-width text, hiragana, katakana, and even related meaning when you forget the exact wording.")}</p>
              </div>
              <HybridSearchDemo />
            </article>
          </div>
        </section>

        {/* Act V: Companions & Native Everywhere */}
        <section id="companions" className="lp-section lp-wrap" aria-labelledby="lp-companions-title">
          <div className="lp-section-head" data-reveal="">
            <span className="lp-kicker">{t("Companions")}</span>
            <h2 id="lp-companions-title">{t("Seven animated companions, synced across every device.")}</h2>
            <p>{t("Pick an expressive paper companion—or upload your own icon—reacting live as you type, think and create.")}</p>
          </div>

          <div className="lp-card lp-companions-card" data-reveal="" onPointerMove={handleCardSpotlight}>
            <CompanionsShowcase />
          </div>

          <div className="lp-pillars" data-reveal="">
            <div className="lp-pillar">
              <span className="lp-pillar-icon" aria-hidden="true"><Smartphone size={18} /></span>
              <h3>{t("Native Web, Android & iOS")}</h3>
              <p>{t("Built natively for every screen with real-time sync via Google, email code or Apple.")}</p>
            </div>
            <div className="lp-pillar">
              <span className="lp-pillar-icon" aria-hidden="true"><Globe size={18} /></span>
              <h3>{t("17 languages, RTL & dark mode")}</h3>
              <p>{t("Full right-to-left Arabic layout, light and dark themes, zero ads, and open exports.")}</p>
            </div>
            <div className="lp-pillar">
              <span className="lp-pillar-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
              <h3>{t("Start free, upgrade only if you need more")}</h3>
              <p>{t("Open the app right away with no account. Sign in anytime to sync across devices.")}</p>
            </div>
          </div>
        </section>

        {/* Act VI: Finale CTA */}
        <section className="lp-wrap lp-finale-wrap" aria-labelledby="lp-finale-title" data-reveal="">
          <div className="lp-finale">
            <div className="lp-finale-mesh" aria-hidden="true" />
            <div className="lp-finale-inner">
              <div className="lp-finale-mascot" aria-hidden="true">
                <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={62} state="idle" hero animated />
              </div>
              <h2 id="lp-finale-title">{t("What is the question you keep coming back to?")}</h2>
              <Link className="lp-finale-cta" href="/app" prefetch={false}>
                <span>{t("Open NoteFable")}</span>
                <ArrowRight size={17} className="rtl-mirror" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-wrap">
        <span className="lp-brand">
          <CharacterGraphic characterId={DEFAULT_CHARACTER_ID} size={20} />
          <span>NoteFable</span>
        </span>
        <div className="lp-footer-end">
          <LanguageMenu className="lp-language" onChoose={onLandingLocale} />
          <nav aria-label={t("Legal")}>
            <Link href="/privacy">{t("Privacy")}</Link>
            <Link href="/terms">{t("Terms")}</Link>
            <Link href="/legal-notice">{t("Commercial disclosure")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
