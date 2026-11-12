import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThreadLanding } from "@/components/thread-landing";
import "./landing.css";

export const metadata: Metadata = {
  title: "StudyMate — Ask it. Keep it. Find it again.",
  description: "AI chat and notes in one place: ask a question, keep the answer as a note, and find it again later.",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  // 保存済みの会話・ノートへの旧リンクは、その指定を保ったままワークスペースへ渡す。
  if (["chat", "message", "view", "page"].some((key) => Object.hasOwn(params, key))) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
      else if (value !== undefined) query.append(key, value);
    }
    redirect(`/app?${query.toString()}`);
  }

  return <ThreadLanding />;
}
