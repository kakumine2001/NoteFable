import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";

// スマホのホーム画面では、上端に Chat / Notes の切替を出し、見出しは余白の中央に置く（会話を始めると空状態ごと消える）。
export function EmptyConversation({ onWorkspaceChange }: { onWorkspaceChange: (view: WorkspaceView) => void }) {
  return (
    <>
      <div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="chat" onChange={onWorkspaceChange} /></div>
      <header className="notion-page-title notion-empty-title motion-page-enter">
        <h1>New chat</h1>
        <p>Ask a question, work through your notes, or bring in a file.</p>
      </header>
    </>
  );
}
