import { CalendarDays, Lightbulb, ListChecks, TextQuote } from "lucide-react";
import { ChatTitleIcon } from "@/components/chat-icon";
import { Mascot } from "@/components/mascot";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

// スマホのホーム画面では、上端に Chat / Notes の切替を出し、見出しは余白の中央に置く（会話を始めると空状態ごと消える）。
// アイコンは見出しの左。まだ会話が保存されていない最初の画面でも選べる。
// 見出しの上にキャラクターを置く。入力欄に文字があるあいだ（hasDraft）は入力欄のほうを見る。
// loading（開いた会話の履歴を読んでいるあいだ）は絵を出さず、場所だけ空けておく。
export function EmptyConversation({ icon, title, hasDraft, loading, onIconChange, onWorkspaceChange }: {
  icon: string | null;
  title?: string;
  hasDraft: boolean;
  loading: boolean;
  onIconChange: (icon: string | null) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="chat" onChange={onWorkspaceChange} /></div>
      <header className="notion-page-title notion-empty-title motion-page-enter">
        <div className="nf-mascot-stage">{!loading && <Mascot lookDown={hasDraft} />}</div>
        <h1 aria-labelledby="chat-heading-text"><ChatTitleIcon icon={icon} onChange={onIconChange} /><span id="chat-heading-text">{title ?? t("New chat")}</span></h1>
        <p>{t("Ask a question, work through your notes, or bring in a file.")}</p>
      </header>
    </>
  );
}

// 書き出しの候補。押すと入力欄にその書き出しが入り、続きを打てる。
const STARTERS = [
  { icon: Lightbulb, label: msg("Explain a concept"), text: msg("Explain this in simple terms:") },
  { icon: ListChecks, label: msg("Quiz me"), text: msg("Quiz me on this topic:") },
  { icon: TextQuote, label: msg("Summarize key points"), text: msg("Summarize the key points of:") },
  { icon: CalendarDays, label: msg("Make a study plan"), text: msg("Make a study plan for:") },
];

// 半角のコロンで終わる言語（英語）は、続きを打ちやすいよう空白を足す。全角の「：」には足さない。
function starterText(text: string) {
  return text.endsWith(":") ? `${text} ` : text;
}

// 空の会話の入力欄の下に並べる（パソコンの幅だけ。スマホは入力欄が画面の下端にあるので出さない）。
// 文字を打ち始めたら消すが、場所は残す（入力欄が上下に動かないように）。
export function StarterPrompts({ hidden, onPick }: { hidden: boolean; onPick: (text: string) => void }) {
  const t = useT();
  return (
    <ul className="nf-starters notion-page-column" data-hidden={hidden || undefined} inert={hidden}>
      {STARTERS.map(({ icon: Icon, label, text }, index) => (
        <li key={label} style={{ "--i": index } as React.CSSProperties}>
          <button type="button" onClick={() => onPick(starterText(t(text)))}><Icon size={15} aria-hidden="true" /><span>{t(label)}</span></button>
        </li>
      ))}
    </ul>
  );
}
