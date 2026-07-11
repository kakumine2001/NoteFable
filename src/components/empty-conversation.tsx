import { BookOpenText } from "lucide-react";

export function EmptyConversation() {
  return (
    <header className="notion-page-title motion-page-enter">
      <div className="notion-page-icon" aria-hidden="true">
        <BookOpenText size={34} strokeWidth={1.65} />
      </div>
      <h1>New chat</h1>
      <p>Ask a question, work through your notes, or bring in a file.</p>
    </header>
  );
}
