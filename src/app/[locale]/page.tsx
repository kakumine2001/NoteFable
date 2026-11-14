import type { Metadata } from "next";
import { ThreadLanding } from "@/components/thread-landing";
import "./landing.css";

export const metadata: Metadata = {
  title: "NoteFable — Ask it. Keep it. Find it again.",
  description: "AI chat and notes in one place: ask a question, keep the answer as a note, and find it again later.",
};

// 古い会話・ノートのリンク（/?chat=… など）のワークスペースへの転送は src/proxy.ts が行う（このページは言語ごとの静的なページ）。
export default function Home() {
  return <ThreadLanding />;
}
