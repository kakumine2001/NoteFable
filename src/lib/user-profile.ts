import { isEmojiIcon } from "@/lib/emoji-icon";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { msg, fmt } from "@/lib/i18n/translate";

export const MAX_DISPLAY_NAME = 40;

// サイドバーの「プロフィール」で使う、ログイン中の利用者の見え方。
// displayName / icon は利用者が自分で決めた値（null は Google の名前・写真を使う）。
export type AccountUser = {
  // 画面に出す名前（displayName があればそれ、なければ Google の名前）。
  name: string | null;
  googleName: string | null;
  email: string | null;
  // Google のプロフィール写真の URL。icon があるときは icon が優先される。
  image: string | null;
  displayName: string | null;
  icon: string | null;
  // 自分でアップロードした写真の URL（自分だけが読める）。あれば icon・Google の写真より優先して表示する。
  avatarUrl: string | null;
  // 設定画面で選んだ表示言語。null は選んでいない（環境の言語に従う）。
  locale: Locale | null;
};

export type ProfilePatch = { displayName?: string | null; avatarIcon?: string | null; locale?: Locale };

type NameResult = { ok: true; value: string | null } | { ok: false };

// 表示名: 空白を整え、空なら null（Google の名前に戻す）。制御文字・向きを変える文字・長すぎる名前は受け付けない。
export function parseDisplayName(value: unknown): NameResult {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, value: null };
  if (/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/.test(name)) return { ok: false };
  if ([...name].length > MAX_DISPLAY_NAME) return { ok: false };
  return { ok: true, value: name };
}

// PATCH /api/account の本文を検証する。送られた項目だけを更新対象にする。
export function parseProfilePatch(body: unknown): { ok: true; data: ProfilePatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: msg("A JSON object is required.") };
  const input = body as Record<string, unknown>;
  const data: ProfilePatch = {};

  if ("displayName" in input) {
    const name = parseDisplayName(input.displayName);
    if (!name.ok) return { ok: false, error: fmt("Name must be 1–{max} characters with no control characters.", { max: MAX_DISPLAY_NAME }) };
    data.displayName = name.value;
  }
  if ("icon" in input) {
    if (input.icon !== null && !isEmojiIcon(input.icon)) return { ok: false, error: msg("Icon must be a single emoji.") };
    data.avatarIcon = input.icon as string | null;
  }
  // 表示言語。「自動」は選択肢にないので、null や対応外の値は受け付けない。
  if ("locale" in input) {
    if (!isLocale(input.locale)) return { ok: false, error: msg("Choose one of the listed languages.") };
    data.locale = input.locale;
  }
  if (!Object.keys(data).length) return { ok: false, error: msg("Nothing to update.") };
  return { ok: true, data };
}

// 写真の保存先（avatars/<利用者 ID>/<UUID>.<拡張子>）。UUID はアップロードのたびに変わるので、URL のバージョンにも使う。
export const AVATAR_ROOT = "avatars";

export function avatarVersion(storagePath: string | null) {
  const file = storagePath?.split("/").pop() ?? "";
  const version = file.replace(/\.[a-z0-9]+$/i, "");
  return /^[0-9a-f-]{36}$/i.test(version) ? version : null;
}

export function toAccountUser(
  row: { displayName: string | null; avatarIcon: string | null; avatarImage: string | null; locale?: string | null },
  google: { name?: string | null; email?: string | null; image?: string | null },
): AccountUser {
  const version = avatarVersion(row.avatarImage);
  return {
    name: row.displayName ?? google.name ?? null,
    googleName: google.name ?? null,
    email: google.email ?? null,
    image: google.image ?? null,
    displayName: row.displayName,
    icon: row.avatarIcon,
    avatarUrl: version ? `/api/account/avatar?v=${version}` : null,
    locale: isLocale(row.locale) ? row.locale : null,
  };
}

// 画面でする編集（サーバーの PATCH と同じ形）。displayName は表示名、icon は絵文字。どちらも null は Google の名前・写真に戻す。
export type ProfileEdit = { displayName?: string | null; icon?: string | null; locale?: Locale };

// 保存の返事を待たずに見せる、編集後の見え方。サーバーと同じ規則: アイコンを選ぶ・戻すと、アップロードした写真は外れる。
export function applyProfileEdit(user: AccountUser, patch: ProfileEdit): AccountUser {
  const displayName = "displayName" in patch ? (patch.displayName ?? null) : user.displayName;
  const icon = "icon" in patch ? (patch.icon ?? null) : user.icon;
  const avatarUrl = "icon" in patch ? null : user.avatarUrl;
  const locale = patch.locale ?? user.locale;
  return { ...user, displayName, icon, avatarUrl, locale, name: displayName ?? user.googleName };
}

// すでにその状態なら送る意味がない（Enter のあとに blur が続いたときの二重送信など）。
export function profileEditChanges(user: AccountUser, patch: ProfileEdit) {
  return JSON.stringify(applyProfileEdit(user, patch)) !== JSON.stringify(user);
}
