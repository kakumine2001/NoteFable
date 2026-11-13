import { useEffect, useSyncExternalStore } from "react";
import { applyProfileEdit, profileEditChanges, type AccountUser, type ProfileEdit } from "@/lib/user-profile";
import { msg } from "@/lib/i18n/translate";

export type Account = {
  configured: boolean;
  user: AccountUser | null;
  googleClientId?: string | null;
};

type Snapshot = { account: Account | null; saveError: string };

// ログイン中の利用者の情報を、ページ全体で 1 か所に持つ。デスクトップ用とスマホのドロワー用に別々のサイドバーが
// 同時に作られても、同じ状態を見て（取得も 1 回だけ）、片方で変えた名前や写真がもう片方に反映されないことがないようにする。
let confirmed: Account | null = null;
// サーバーにまだ確定していない編集。画面には「確定済みの状態 + これらの編集」を見せる。
let pending: ProfileEdit[] = [];
let saveError = "";
let loadStarted = false;
// 保存はこの鎖で 1 件ずつ順番に送る。送った順に確定するので、古い返事が新しい編集を巻き戻さない。
let chain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const serverSnapshot: Snapshot = { account: null, saveError: "" };
let snapshot: Snapshot = serverSnapshot;

function view(): Account | null {
  if (!confirmed?.user) return confirmed;
  return { ...confirmed, user: pending.reduce(applyProfileEdit, confirmed.user) };
}

function publish() {
  snapshot = { account: view(), saveError };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const LOAD_RETRY_MS = [2000, 6000, 15000];

export function loadAccount(attempt = 0) {
  if (loadStarted) return;
  loadStarted = true;
  // 取得できなかったときは、少し待って数回やり直す（一時的な通信エラーで、ログインボタンが出ないままにならないように）。
  const retry = () => {
    loadStarted = false;
    const delay = LOAD_RETRY_MS[attempt];
    if (delay !== undefined) setTimeout(() => loadAccount(attempt + 1), delay);
  };
  fetch("/api/account", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: Account | null) => {
      if (!data) return retry();
      confirmed = data;
      publish();
    })
    .catch(retry);
}

// テスト用: 今の見え方（確定済みの状態 + 送信待ちの編集）。
export function getAccountSnapshot() {
  return snapshot;
}

export function useAccount() {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  useEffect(() => loadAccount(), []);
  return current;
}

async function sendPatch(patch: ProfileEdit) {
  try {
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.user) throw new Error(typeof data.error === "string" ? data.error : msg("Could not save."));
    if (confirmed) confirmed = { ...confirmed, user: data.user as AccountUser };
    // 保存できたら、先の編集で出たエラー表示は消す。
    saveError = "";
  } catch (error) {
    // 失敗した編集だけを取り除く（あとに続く編集は残る）。
    saveError = error instanceof Error ? error.message : msg("Could not save.");
  } finally {
    pending.shift();
    publish();
  }
}

// 名前・アイコン・Google の表示に戻す、を保存する。画面へはすぐ反映し、送信は順番に行う。すでにその状態なら何もしない。
export function saveProfile(patch: ProfileEdit) {
  const current = view()?.user;
  if (!current || !profileEditChanges(current, patch)) return chain;
  pending.push(patch);
  saveError = "";
  publish();
  chain = chain.then(() => sendPatch(patch));
  return chain;
}

async function sendPhoto(photo: Blob) {
  try {
    const body = new FormData();
    body.append("file", photo, "avatar");
    const response = await fetch("/api/account/avatar", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.user) return typeof data.error === "string" ? data.error : msg("Could not upload that photo. Try again.");
    if (confirmed) confirmed = { ...confirmed, user: data.user as AccountUser };
    saveError = "";
    publish();
    return "";
  } catch {
    return msg("Could not upload that photo. Check your connection and try again.");
  }
}

// 切り抜いた写真を保存する。名前などの保存と同じ順番に並べて送る。失敗したときは理由の文を返し、成功したら空文字を返す。
export function uploadPhoto(photo: Blob): Promise<string> {
  const run = chain.then(() => sendPhoto(photo));
  chain = run.then(() => undefined);
  return run;
}

// 送信中の保存がすべて終わるまで待つ（ログアウトの前に、直前の編集を取りこぼさないため）。
export function settled() {
  return chain;
}

export function clearSaveError() {
  if (!saveError) return;
  saveError = "";
  publish();
}

// テスト用: 状態を最初に戻す。
export function resetAccountStore() {
  confirmed = null;
  pending = [];
  saveError = "";
  loadStarted = false;
  chain = Promise.resolve();
  snapshot = serverSnapshot;
}
