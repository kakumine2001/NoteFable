"use client";

import {
  ArrowRight, ArrowUp, BookOpen, Copy, FileText, Folder, Globe, History,
  MessageSquareText, MoreHorizontal, NotebookPen, Paperclip, Plus, Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LandingNativeRedirect } from "@/components/landing-native-redirect";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "@/lib/models";

// 同じ問いを英語・中国語・日本語で打ち直す。ページ全体がこの一つの問いを追いかける。
const QUESTIONS = [
  "Why is the sunset red if the sky is blue?",
  "为什么天空是蓝的，晚霞却是红的？",
  "空は青いのに、夕焼けはなぜ赤い？",
  "Explain Rayleigh scattering like I'm twelve.",
];

const DEFAULT_MODEL_LABEL = MODEL_OPTIONS.find((model) => model.id === DEFAULT_MODEL)?.label ?? MODEL_OPTIONS[0].label;

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

function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="12 5 44 56" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path strokeWidth="3.2" d="M18 12.5 43 9c4-.6 7 2 7 5.7v34c0 3.1-2.2 5.8-5.2 6.2L26 57.2c-4.8.6-8.8-3.1-8.8-7.9V17.1c0-2.3 1.7-4.3 4-4.6Z" />
      <path strokeWidth="2.8" d="M20.2 18 45.5 14.4c2-.3 3.8.5 4.5 2.1M18 23.8 42 20.5c4.6-.6 8.3 3 8.3 7.6M30 29h14v9.5H30zM25.2 44v12.7l4.4-3 4.5 2V43.4M24 40.1h2.8" />
    </svg>
  );
}

// 回答が流れてくる様子を、単語ごとの遅延で表す。
function stream(parts: Array<string | { strong: string }>) {
  let count = 0;
  return parts.flatMap((part, partIndex) => {
    const strong = typeof part !== "string";
    return (strong ? part.strong : part).split(" ").filter(Boolean).map((word, wordIndex) => {
      const style = { "--i": count++ } as React.CSSProperties;
      const key = `${partIndex}-${wordIndex}`;
      return strong
        ? <strong className="tl-word" style={style} key={key}>{word} </strong>
        : <span className="tl-word" style={style} key={key}>{word} </span>;
    });
  });
}

type Station = { id: string; label: string; title: string; body: string; card: ReactNode };

const STATIONS: Station[] = [
  {
    id: "ask",
    label: "Ask",
    title: "Start with whatever you have.",
    body: "A question, a PDF, a screenshot, half a sentence. Choose the model that suits it and how hard it should think.",
    card: (
      <div className="tl-card tl-card-ask">
        <p className="tl-bubble">Why is the sunset red if the sky is blue?</p>
        <span className="tl-file"><Paperclip size={13} /> optics-ch3.pdf</span>
        <ul className="tl-models" aria-label="Available models">
          {MODEL_OPTIONS.map((model) => <li key={model.id} data-current={model.id === DEFAULT_MODEL || undefined}>{model.label}</li>)}
        </ul>
      </div>
    ),
  },
  {
    id: "understand",
    label: "Understand",
    title: "Get an answer you can push on.",
    body: "Follow up, ask for another angle, or let it search the web and show its sources. Switch to image mode when a picture explains it better.",
    card: (
      <div className="tl-card tl-card-answer">
        <span className="tl-card-meta"><Globe size={13} /> Searched the web · 3 sources</span>
        <p>{stream(["Both come from", { strong: "Rayleigh scattering." }, "Air scatters short blue wavelengths the most, so at noon blue reaches you from every direction. At sunset the light crosses far more air, the blue is scattered away, and red is what is left."])}</p>
        <div className="tl-actions">
          <span><Copy size={13} /> Copy</span>
          <span className="tl-action-save"><NotebookPen size={13} /> Save to Notes</span>
          <span aria-hidden="true"><MoreHorizontal size={15} /></span>
        </div>
      </div>
    ),
  },
  {
    id: "keep",
    label: "Keep",
    title: "Save the part worth keeping.",
    body: "One click turns an answer into a note you can edit. Every note keeps its edit history, and deleted notes wait in Trash for 30 days.",
    card: (
      <div className="tl-card tl-card-note">
        <span className="tl-note-emoji" aria-hidden="true">🌅</span>
        <h4>Why sunsets are red</h4>
        <h5>Rayleigh scattering</h5>
        <ul>
          <li>Scattering ∝ 1/λ⁴, so blue scatters 5–6× more than red</li>
          <li>Noon: short path, blue from everywhere</li>
          <li>Sunset: long path, blue removed, red remains</li>
        </ul>
        <p className="tl-note-own">In my own words: the sky keeps the blue for itself<i aria-hidden="true" /></p>
        <span className="tl-card-meta"><History size={13} /> Saved · history kept</span>
      </div>
    ),
  },
  {
    id: "connect",
    label: "Connect",
    title: "Give related chats one home.",
    body: "Group chats into a project, give it standing instructions, and attach the notes it should always have in mind.",
    card: (
      <div className="tl-card tl-card-project">
        <h4><Folder size={16} /> Physics 101</h4>
        <dl>
          <dt>Instructions</dt>
          <dd className="tl-project-quote">Explain with everyday examples. Quiz me at the end.</dd>
          <dt>Reference notes</dt>
          <dd><span><BookOpen size={13} /> Why sunsets are red</span><span><BookOpen size={13} /> Lens formula cheatsheet</span></dd>
          <dt>Chats</dt>
          <dd><span><MessageSquareText size={13} /> Sunset colours</span><span><MessageSquareText size={13} /> Why is the ocean blue?</span><span><MessageSquareText size={13} /> Polarised sunglasses</span></dd>
        </dl>
      </div>
    ),
  },
  {
    id: "find",
    label: "Find",
    title: "Find it again, however you typed it.",
    body: "Search runs across chats, notes and attached files. Capitals, full-width letters, hiragana or katakana: it matches them all.",
    card: (
      <div className="tl-card tl-card-search">
        <div className="tl-search-box"><Search size={15} /><span>ｒａｙｌｅｉｇｈ</span><kbd>full-width, lower-case</kbd></div>
        <ul>
          <li><BookOpen size={14} /><div><strong>Why sunsets are red</strong><p><mark>Rayleigh</mark> scattering · Scattering ∝ 1/λ⁴…</p></div></li>
          <li><MessageSquareText size={14} /><div><strong>Sunset colours</strong><p>Both come from <mark>Rayleigh</mark> scattering. Air scatters…</p></div></li>
          <li><FileText size={14} /><div><strong>optics-ch3.pdf</strong><p>3.2 <mark>RAYLEIGH</mark> SCATTERING AND THE COLOUR OF…</p></div></li>
        </ul>
      </div>
    ),
  },
];

const FACTS = [
  { title: "No account needed", body: "Open it and start. Your chats and notes are tied to this browser." },
  { title: "Google sign-in, if you want it", body: "Sign in to carry the same chats and notes to another device." },
  { title: "An assistant inside every note", body: "Ask about the page you are writing without leaving it." },
];

export function ThreadLanding() {
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
      <LandingNativeRedirect />
      <a className="tl-skip" href="#tl-main">Skip to content</a>

      <header className="tl-nav tl-wrap">
        <Link className="tl-brand" href="/" aria-label="StudyMate home"><BrandMark /><span>StudyMate</span></Link>
        <Link className="tl-nav-cta" href="/app" prefetch={false}>Open workspace <ArrowRight size={15} aria-hidden="true" /></Link>
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
            <p className="tl-kicker">AI chat and notes, in one place</p>
            <h1 id="tl-title"><span className="tl-rise">Ask it.</span> <span className="tl-rise"><span className="tl-mark">Keep it.</span></span><br /><span className="tl-rise">Find it again.</span></h1>
            <p className="tl-lede">StudyMate is a study space where a question becomes an answer, the answer becomes a note, and the note is still there when you need it.</p>

            <Link className="tl-composer" href="/app" prefetch={false} aria-label="Open StudyMate and ask a question">
              <span className="tl-composer-text" aria-hidden="true"><TypedQuestion /></span>
              <span className="tl-composer-bar" aria-hidden="true">
                <span className="tl-composer-plus"><Plus size={17} /></span>
                <span className="tl-composer-model">{DEFAULT_MODEL_LABEL}</span>
                <span className="tl-composer-send"><ArrowUp size={17} /></span>
              </span>
            </Link>
            <p className="tl-hero-note">Click the box to start. No account needed.</p>
            <div className="tl-stem" aria-hidden="true" />
          </div>
        </section>

        <section className="tl-journey-section tl-wrap" aria-labelledby="tl-journey-title">
          <h2 id="tl-journey-title" className="tl-sr">How one question travels through StudyMate</h2>
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

        <section className="tl-facts tl-wrap" aria-label="Good to know">
          {FACTS.map((fact) => <div key={fact.title}><h3>{fact.title}</h3><p>{fact.body}</p></div>)}
        </section>

        <section className="tl-wrap" aria-labelledby="tl-finale-title">
          <div className="tl-finale">
            <h2 id="tl-finale-title">What is the question you keep coming back to?</h2>
            <Link className="tl-finale-cta" href="/app" prefetch={false}>Open StudyMate <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="tl-footer tl-wrap">
        <span className="tl-brand"><BrandMark size={20} /><span>StudyMate</span></span>
        <nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </div>
  );
}
