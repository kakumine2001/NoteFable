import { ChatTitleIcon } from "@/components/chat-icon";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";

// スマホのホーム画面では、上端に Chat / Notes の切替を出し、見出しは余白の中央に置く（会話を始めると空状態ごと消える）。
// アイコンは見出しの左。まだ会話が保存されていない最初の画面でも選べる。
export function EmptyConversation({ icon, title = "New chat", onIconChange, onWorkspaceChange }: {
  icon: string | null;
  title?: string;
  onIconChange: (icon: string | null) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
}) {
  return (
    <>
      <div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="chat" onChange={onWorkspaceChange} /></div>
      <header className="notion-page-title notion-empty-title motion-page-enter">
        <h1 aria-labelledby="chat-heading-text"><ChatTitleIcon icon={icon} onChange={onIconChange} /><span id="chat-heading-text">{title}</span></h1>
        <p>Ask a question, work through your notes, or bring in a file.</p>
      </header>
    </>
  );
}
