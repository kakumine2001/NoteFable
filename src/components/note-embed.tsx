"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { DrawDiagramHost } from "@/components/draw-diagram-dialog";
import { NoteHistoryDialog } from "@/components/note-history-dialog";
import { NotesWorkspace } from "@/components/notes-workspace";
import { useModels } from "@/components/models-provider";
import { readEmbedModelPreference, readModelPreference, resolveModelPreference } from "@/lib/model-preference";
import { saveAppIcon } from "@/lib/app-icon";
import { createEmbedApi, installEmbedApi, REVEAL_TARGET, pageMeta, postToNative, readNativeAppIcon, readNativeLanguage, readNativeTheme, toEmbedSaveState } from "@/lib/native-bridge";
import { parseThemePreference, saveThemePreference } from "@/lib/theme";
import { useNotePages } from "@/lib/use-note-pages";
import { pageKindOf } from "@/lib/page-kinds";
import { cancelCanvasReveal, revealNoteBlock } from "@/lib/search-reveal";
import { cancelWhiteboardReveal, requestWhiteboardReveal } from "@/lib/whiteboard/reveal";
import { flushCanvasEditors } from "@/lib/canvas-flush";
import { cancelNativeExports } from "@/lib/export-file";
import { closeDiagramDialog } from "@/lib/draw-diagram-jobs";
import { afterSheetHistory } from "@/lib/use-back-to-close";

const noop = () => {};

function cancelReveals(abortRef: { current: AbortController | null }) {
  cancelWhiteboardReveal();
  cancelCanvasReveal();
  abortRef.current?.abort();
  abortRef.current = null;
}

function revealBlock(abortRef: { current: AbortController | null }, target: string) {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  void revealNoteBlock(target, { signal: controller.signal });
}

// Android / iOS アプリが WebView に載せる埋め込みノート画面（/note-embed?page=<id>）。
// ホワイトボード・スライドもこの同じ URL で開く（古いアプリは別の URL をシステムのブラウザに渡してしまうため）。
// 新しいアプリは 1 つの WebView を常駐再利用し、window.notefableEmbed.openPage / close / pageTrashed で
// ページ全体を再読み込みせずにキャッシュ済みのページへ即座に切り替える。
// 中身は /app のスマホのノート画面の本文（封面・アイコン・題名・BlockNote・AI ボタン）と同じ部品で、上部バーとサイドバーはアプリ側が描く。
// 保存・下書きの退避・衝突の扱いは useNotePages と NoteSaveQueue をそのまま使う。アプリとのやり取りは src/lib/native-bridge.ts。
export function NoteEmbed() {
  const { t, locale, setPreference, changeError } = useI18n();
  const expectedPageRef = useRef<string | null>(null);
  const notes = useNotePages(false, {
    embedded: true,
    onMissing: (id) => {
      if (expectedPageRef.current === id) postToNative({ type: "missing", id });
    },
  });
  const { active, activeId, loading, select, deactivate } = notes;
  const [pageId, setPageId] = useState<string | null>(null);
  // アプリが一時的に一覧・チャットへ戻っている間（close() 後）は、編集画面の DOM を外してキャッシュだけ保つ。
  const [idle, setIdle] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // AI アシスタントは、アプリが URL（&model=&reasoning=）または openPage で渡したモデルと推論強度を使う。
  // 渡されていない・今の一覧にないときは /app と同じく、このブラウザ（WebView）で最後に選んだもの、それもなければサーバーの標準。
  const { defaultModel, getModelOption, options } = useModels();
  const [model, setModel] = useState(defaultModel);
  const [reasoning, setReasoning] = useState<string>(() => getModelOption(defaultModel).defaultReasoning);
  const optionsRef = useRef(options);
  const activeRef = useRef(active);
  // 開いたページの読み込みが終わってから動かす（ページの種類で動かし方が違う）。
  const revealRef = useRef<{ pageId: string; target: string } | null>(null);
  const initialLoadedRef = useRef(false);
  const backupErrorRef = useRef(notes.backupError);
  // 最後の flush で、ホワイトボードなどのエディターが変更を渡し切れたか（アップロードが終わらない画像が残ると false）。
  const canvasHanded = useRef(true);
  const sent = useRef({ readyId: "", meta: "", state: "", goneId: "" });
  // openPage のたびに進める。閉じてすぐ同じページを開き直すと idle・activeId などが前の描画と同じ値に戻り、
  // ready を送る effect が走らない（アプリはその ready を待って以降のメッセージを捨て続ける）ので、依存に入れて必ず走らせる。
  const [openToken, setOpenToken] = useState(0);
  // 最新の openPage の番号（同期で進める）。openPage より前の描画の effect が後から走っても、前のページを ready として送り直したり
  // expectedPageRef を前のページへ戻したりしない（戻すと新しいページの missing と URL の書き換えが止まる）。
  const openTokenRef = useRef(0);
  // openPage で切り替えた先。URL の書き換えは描画の後（閉じたシートの history.back の予約が済んでから）に行う。
  const urlPageRef = useRef<string | null>(null);
  // 前のページ宛ての検索結果への移動（DOM の監視・預かり）を、切り替え・閉じる時に止める。
  const revealAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    activeRef.current = active;
    backupErrorRef.current = notes.backupError;
  }, [options, active, notes.backupError]);

  // ページは静的に配るので、初回に開くノートは表示後に URL から読む（2 ページ目以降は openPage で切り替える）。
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    const params = new URL(window.location.href).searchParams;
    const id = params.get("page");
    const restored = resolveModelPreference(readEmbedModelPreference(params), options)
      ?? resolveModelPreference(readModelPreference(), options);
    queueMicrotask(() => {
      if (restored) { setModel(restored.model); setReasoning(restored.reasoning); }
      setPageId(id);
      if (!id && params.get("warm") === "1") setIdle(true);
    });
    if (!id) {
      if (params.get("warm") !== "1") postToNative({ type: "missing" });
      return;
    }
    expectedPageRef.current = id;
    // reveal：検索の結果から開いたとき、一致したブロック（ノート）・要素（ホワイトボード）まで動かす。
    const reveal = params.get("reveal");
    // 読み込みの前に預けておく（読み込み後の描画で下の effect が受け取る）。
    if (reveal && REVEAL_TARGET.test(reveal)) revealRef.current = { pageId: id, target: reveal };
    void select(id, "none", { keepCurrent: false }).then((opened) => {
      if (!opened && expectedPageRef.current === id) postToNative({ type: "missing", id });
    });
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
    // ホワイトボードなどのエディターがまだ渡していない変更（描き終わり待ち・画像のアップロード中）を先に渡してもらってから送る。
    // 待っても終わらないアップロードが残ったら false（アプリは編集画面を閉じずに知らせる）。
    flush: async () => {
      const handed = await flushCanvasEditors();
      canvasHanded.current = handed;
      const saved = await (activeRef.current?.flush() ?? true);
      const current = activeRef.current;
      // フラッシュで version が進んだ直後は、flushed より先に最新の meta(version) を届けて、直後の重命名等が古い版を送らないようにする。
      if (handed && saved && current && sent.current.readyId === current.page.id) {
        const meta = pageMeta({ title: current.content.title, icon: current.content.icon ?? null });
        const metaKey = JSON.stringify({ ...meta, version: current.version });
        if (sent.current.meta !== metaKey) {
          sent.current.meta = metaKey;
          postToNative({ type: "meta", ...meta, version: current.version });
        }
      }
      return handed && saved;
    },
    // 衝突ではなく一時的な失敗（オフライン・サーバーエラー）で、下書きを localStorage に退避できているときだけ。/app と同じく離れても後で送り直せる。
    // ホワイトボードの画像がまだアップロード中（下書きにも入っていない）なら、離れると失うので「残っている」とは言わない。
    draftKept: () => canvasHanded.current && activeRef.current?.status === "error" && !backupErrorRef.current,
    openHistory: () => { if (activeRef.current) setHistoryOpen(true); },
    // すでに開いているページの検索結果：開き直さずに一致した場所まで動かす。
    reveal: (target) => {
      const queue = activeRef.current;
      if (!queue) return;
      if (pageKindOf(queue.page) === "whiteboard") requestWhiteboardReveal(queue.page.id, target);
      else revealBlock(revealAbortRef, target);
    },
    // 常駐 WebView の中で別ページ（または以前開いたページ）へ即座に切り替える。履歴は積まない（canGoBack を汚さない）。
    openPage: ({ id, reveal, model: nextModel, reasoning: nextReasoning }) => {
      cancelReveals(revealAbortRef);
      cancelNativeExports();
      setHistoryOpen(false);
      // 「画成図」の窓は隠すだけ（要求と結果は残り、同じノートでもう一度選ぶと開き直す）。
      closeDiagramDialog();
      sent.current = { readyId: "", meta: "", state: "", goneId: "" };
      expectedPageRef.current = id;
      urlPageRef.current = id;
      openTokenRef.current += 1;
      setOpenToken(openTokenRef.current);
      revealRef.current = reveal ? { pageId: id, target: reveal } : null;
      if (nextModel || nextReasoning) {
        const params = new URLSearchParams();
        if (nextModel) params.set("model", nextModel);
        if (nextReasoning) params.set("reasoning", nextReasoning);
        const resolved = resolveModelPreference(readEmbedModelPreference(params), optionsRef.current);
        if (resolved) { setModel(resolved.model); setReasoning(resolved.reasoning); }
      }
      setIdle(false);
      setPageId(id);
      void select(id, "none", { keepCurrent: false }).then((opened) => {
        if (!opened && expectedPageRef.current === id) postToNative({ type: "missing", id });
      });
    },
    // 一覧・チャットへ戻るとき：エディター DOM を外してキャッシュだけ残す。
    close: () => {
      cancelReveals(revealAbortRef);
      cancelNativeExports();
      setHistoryOpen(false);
      closeDiagramDialog();
      revealRef.current = null;
      expectedPageRef.current = null;
      urlPageRef.current = null;
      sent.current = { readyId: "", meta: "", state: "", goneId: "" };
      setIdle(true);
      setPageId(null);
      deactivate();
    },
    post: (message) => { postToNative(message); },
  })), [deactivate, select, setPreference]);

  const title = active?.content.title;
  const icon = active?.content.icon;
  const version = active?.version;
  const status = active?.status;
  const gone = active?.gone;
  const kind = pageKindOf(active?.page);
  useEffect(() => {
    if (idle || !active || !activeId || loading || title === undefined) return;
    if (openToken !== openTokenRef.current) return;
    const meta = pageMeta({ title, icon: icon ?? null });
    const metaKey = JSON.stringify({ ...meta, version });
    // 衝突を「新しいノートとして保存」すると、開いているノートが新しいページに替わる。そのときも ready を送り直す。
    if (sent.current.readyId !== activeId) {
      expectedPageRef.current = activeId;
      sent.current = { readyId: activeId, meta: metaKey, state: "", goneId: "" };
      postToNative({ type: "ready", page: { id: activeId, ...meta, kind, version } });
    } else if (sent.current.meta !== metaKey) {
      sent.current.meta = metaKey;
      postToNative({ type: "meta", ...meta, version });
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
      postToNative({ type: "missing", id: activeId });
    }
  }, [idle, active, activeId, loading, title, icon, version, status, gone, kind, openToken]);

  useEffect(() => {
    const request = revealRef.current;
    if (idle || !request || !active || activeId !== request.pageId || loading) return;
    revealRef.current = null;
    if (kind === "whiteboard") requestWhiteboardReveal(request.pageId, request.target);
    else revealBlock(revealAbortRef, request.target);
  }, [idle, active, activeId, loading, kind, openToken]);

  // openPage で切り替えた先を URL に書く。閉じた履歴ダイアログ・AI パネル（useBackToClose）の後始末は同じ描画の
  // effect の片付けで history.back を予約するので、その後に走るここから afterSheetHistory に渡せば、戻った後に書き換えられる。
  useEffect(() => {
    const id = urlPageRef.current;
    if (!id || idle || pageId !== id) return;
    urlPageRef.current = null;
    afterSheetHistory(() => {
      if (expectedPageRef.current !== id) return;
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("page", id);
        url.searchParams.delete("reveal");
        url.searchParams.delete("warm");
        window.history.replaceState(window.history.state, "", url);
      } catch { /* URL 更新できなくても表示切り替えは続ける。 */ }
    });
  }, [idle, pageId, openToken]);

  const retry = async () => {
    if (!pageId) return;
    const opened = await select(pageId, "none", { keepCurrent: false });
    if (!opened && expectedPageRef.current === pageId) postToNative({ type: "missing", id: pageId });
  };

  if (idle) {
    return <main className="notion-workspace flex h-dvh" />;
  }

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
        <NoteHistoryDialog key={activeId} noteId={activeId} getVersion={() => active.version} flush={async () => { await flushCanvasEditors(); return active.flush(); }}
          onRestored={() => setHistoryOpen(false)} onClose={() => setHistoryOpen(false)} />
      )}
      {/* AI パネルの「画成図」の窓。「Open whiteboard」はアプリにページを開いてもらう（WebView の中では移動しない）。 */}
      <DrawDiagramHost embedded />
    </main>
  );
}
