import type { Metadata } from "next";
import { NoteEmbed } from "@/components/note-embed";

export const metadata: Metadata = {
  title: "StudyMate",
  robots: { index: false, follow: false },
};

// Android アプリが WebView に載せるノートのエディターだけの画面（/note-embed?page=<id>）。言語ごとの静的なページで、
// どの言語を出すかは src/proxy.ts が決める（アプリは ?lang= で指定できる）。開くノートはブラウザ側で URL から読む。
export default function NoteEmbedPage() {
  return <NoteEmbed />;
}
