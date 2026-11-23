"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { NoteHistoryDialog } from "@/components/note-history-dialog";
import { NotesWorkspace } from "@/components/notes-workspace";
import { useModels } from "@/components/models-provider";
import { readEmbedModelPreference, readModelPreference, resolveModelPreference } from "@/lib/model-preference";
import { saveAppIcon } from "@/lib/app-icon";
import { createEmbedApi, installEmbedApi, pageMeta, postToNative, readNativeAppIcon, readNativeLanguage, readNativeTheme, toEmbedSaveState } from "@/lib/native-bridge";
import { parseThemePreference, saveThemePreference } from "@/lib/theme";
import { useNotePages } from "@/lib/use-note-pages";
import { pageKindOf } from "@/lib/page-kinds";
import { revealNoteBlock } from "@/lib/search-reveal";
import { requestWhiteboardReveal } from "@/lib/whiteboard/reveal";

const noop = () => {};

// Android アプリが WebView に載せる、1 ページだけのノート画面（/note-embed?page=<id>）。
// ホワイトボード・スライドもこの同じ URL で開く（古いアプリは別の URL をシステムのブラウザに渡してしまうため）。エディターができるまでは
// NotesWorkspace が読み取り専用の仮の画面を出し、橋渡し（flush・saveState・openHistory・pageUpdated・pageSettings・theme・language など）は
// ノートと同じに動く（保存するものが無いので flush はいつも ok）。
// 中身は /app のスマホのノート画面の本文（封面・アイコン・題名・BlockNote・AI ボタン）と同じ部品で、上部バーとサイドバーはアプリ側が描く。
// 保存・下書きの退避・衝突の扱いは useNotePages と NoteSaveQueue をそのまま使う。アプリとのやり取りは src/lib/native-bridge.ts。
export function NoteEmbed() {
  const { t, locale, setPreference, changeError } = useI18n();
  const notes = useNotePages(false, { embedded: true });
  const { active, activeId, loading } = notes;
  const [pageId, setPageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // AI アシスタントは、アプリが URL（&model=&reasoning=）で渡したモデルと推論強度を使う。渡されていない・今の一覧にないときは
  // /app と同じく、このブラウザ（WebView）で最後に選んだもの、それもなければサーバーの標準。
  const { defaultModel, getModelOption, options } = useModels();
  const [model, setModel] = useState(defaultModel);
  const [reasoning, setReasoning] = useState<string>(() => getModelOption(defaultModel).defaultReasoning);
  const activeRef = useRef(active);
  // 開いたページの読み込みが終わってから動かす（ページの種類で動かし方が違う）。
  const revealRef = useRef<{ pageId: string; target: string } | null>(null);
  const backupErrorRef = useRef(notes.backupError);
  const sent = useRef({ readyId: "", meta: "", state: "", goneId: "" });
  const { select } = notes;

  useEffect(() => { activeRef.current = active; backupErrorRef.current = notes.backupError; }, [active, notes.backupError]);

  // ページは静的に配るので、開くノートは表示後に URL から読む。
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const id = params.get("page");
    const restored = resolveModelPreference(readEmbedModelPreference(params), options)
      ?? resolveModelPreference(readModelPreference(), options);
    queueMicrotask(() => {
      if (restored) { setModel(restored.model); setReasoning(restored.reasoning); }
      setPageId(id);
    });
    if (!id) { postToNative({ type: "missing" }); return; }
    // reveal：検索の結果から開いたとき、一致したブロック（ノート）・要素（ホワイトボード）まで動かす。
    const reveal = params.get("reveal");
    // 読み込みの前に預けておく（読み込み後の描画で下の effect が受け取る）。
    if (reveal && /^[A-Za-z0-9_-]{1,120}$/.test(reveal)) revealRef.current = { pageId: id, target: reveal };
    void select(id, "none").then((opened) => { if (!opened) postToNative({ type: "missing" }); });
  }, [select, options]);

  // AI ボタンのアイコンは、アプリの設定で選んだものに合わせる（アプリが渡さないときは変えない）。開いている間の変更は
  // window.notefableEmbed.appIcon で届く。
  useEffect(() => {
    const icon = readNativeAppIcon();
    if (icon !== undefined) saveAppIcon(icon);
    const nativeLocale = readNativeLanguage();
    if (nativeLocale) void setPreference(nativeLocale);
    const urlTheme = parseThemePreference(new URL(window.location.href).searchParams.get("theme"));
    const nativeTheme = readNativeTheme() ?? urlTheme;
    if (nativeTheme) saveThemePreference(nativeTheme);
  }, [setPreference]);

  // アプリから呼ぶ window.notefableEmbed。flush は開いているノートの未保存の編集を送り切る。
  // pageUpdated（アプリのチャットで編集案を適用した）は既定のまま notefable:page-updated を出し、useNotePages が /app と同じく扱う。
  useEffect(() => installEmbedApi(createEmbedApi({
    language: (next) => setPreference(next),
    flush: () => activeRef.current?.flush() ?? Promise.resolve(true),
    // 衝突ではなく一時的な失敗（オフライン・サーバーエラー）で、下書きを localStorage に退避できているときだけ。/app と同じく離れても後で送り直せる。
    draftKept: () => activeRef.current?.status === "error" && !backupErrorRef.current,
    openHistory: () => { if (activeRef.current) setHistoryOpen(true); },
    post: (message) => { postToNative(message); },
  })), [setPreference]);

  const title = active?.content.title;
  const icon = active?.content.icon;
  const status = active?.status;
  const gone = active?.gone;
  const kind = pageKindOf(active?.page);
  useEffect(() => {
    if (!active || !activeId || loading || title === undefined) return;
    const meta = pageMeta({ title, icon: icon ?? null });
    // 衝突を「新しいノートとして保存」すると、開いているノートが新しいページに替わる。そのときも ready を送り直す。
    if (sent.current.readyId !== activeId) {
      sent.current = { readyId: activeId, meta: JSON.stringify(meta), state: "", goneId: "" };
      postToNative({ type: "ready", page: { id: activeId, ...meta, kind } });
    } else if (sent.current.meta !== JSON.stringify(meta)) {
      sent.current.meta = JSON.stringify(meta);
      postToNative({ type: "meta", ...meta });
    }
    const state = status ? toEmbedSaveState(status) : "saved";
    if (sent.current.state !== state) {
      sent.current.state = state;
      postToNative({ type: "saveState", state });
    }
    // 保存が 404（別の端末でゴミ箱に入れた・完全に削除した）なら、再送しても通らない。下書きは localStorage に残したまま、
    // アプリに missing を送って編集画面を閉じてもらう（閉じないと flush が失敗し続けて、どこへも移れなくなる）。
    if (gone && sent.current.goneId !== activeId) {
      sent.current.goneId = activeId;
      postToNative({ type: "missing" });
    }
  }, [active, activeId, loading, title, icon, status, gone, kind]);

  useEffect(() => {
    const request = revealRef.current;
    if (!request || !active || activeId !== request.pageId || loading) return;
    revealRef.current = null;
    if (kind === "whiteboard") requestWhiteboardReveal(request.pageId, request.target);
    else void revealNoteBlock(request.target);
  }, [active, activeId, loading, kind]);

  const retry = async () => { if (pageId) await select(pageId, "none"); };

  return (
    <main className="notion-workspace flex h-dvh">
      <section className="notion-page">
        <div className="flex min-h-0 flex-1 flex-col">
          {changeError && <div role="alert" className="language-menu-error">
            {t(changeError)} <button type="button" className="notion-button" onClick={() => void setPreference(readNativeLanguage() ?? locale)}>{t("Try again")}</button>
          </div>}
          <NotesWorkspace notes={{ ...notes, load: retry }} listMode={false} embedded model={model} reasoning={reasoning}
            onOpen={noop} onCreate={noop} onWorkspaceChange={noop} />
        </div>
      </section>
      {historyOpen && active && activeId && (
        <NoteHistoryDialog key={activeId} noteId={activeId} getVersion={() => active.version} flush={() => active.flush()}
          onRestored={() => setHistoryOpen(false)} onClose={() => setHistoryOpen(false)} />
      )}
    </main>
  );
}
