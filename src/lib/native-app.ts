import { msg } from "@/lib/i18n/translate";
// Android アプリ（mobile/ の Capacitor 外壳）の中で開かれているときだけ使える、端末側の Google ログイン。
// 外壳はサイトを URL で開くだけで、Capacitor の JS ランタイムは読み込まれない。native-bridge が差し込む
// window.Capacitor.nativePromise でプラグイン（SocialLogin）を直接呼ぶ。
type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
};

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  return capacitor?.isNativePlatform?.() && capacitor.nativePromise ? capacitor : null;
}

export function canSignInNatively() {
  return bridge() !== null;
}

// Android アプリの中か。外壳は Blob URL のダウンロード（<a download>）を受け取れないので、その操作は出さない。
export function isNativeApp() {
  return bridge() !== null;
}

// 端末の Google アカウント選択画面を出し、ID トークンをサーバーで検証してもらってログイン Cookie を受け取る。
// ユーザーが画面を閉じた場合は false を返し、それ以外の失敗は例外にする。
export async function signInWithNativeGoogle(webClientId: string) {
  const native = bridge();
  if (!native?.nativePromise) throw new Error(msg("Native Google sign-in is not available."));

  // サーバーが発行する使い捨ての値。Google の ID トークンに埋め込まれ、使い回しを防ぐ。
  const nonceResponse = await fetch("/api/native-auth/nonce", { method: "POST" });
  if (!nonceResponse.ok) throw new Error(msg("Could not start the Google sign-in."));
  const { nonce } = (await nonceResponse.json()) as { nonce: string };

  await native.nativePromise("SocialLogin", "initialize", { google: { webClientId } });

  let idToken: string | null | undefined;
  try {
    // scopes は渡さない（渡すと MainActivity の改造が必要になる）。メールとプロフィールは標準で含まれる。
    const login = (await native.nativePromise("SocialLogin", "login", {
      provider: "google",
      options: { nonce },
    })) as { result?: { idToken?: string | null } };
    idToken = login.result?.idToken;
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "USER_CANCELLED") return false;
    throw error;
  }
  if (!idToken) throw new Error(msg("Google did not return an ID token."));

  const response = await fetch("/api/native-auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error(msg("The server rejected the Google sign-in."));
  return true;
}

// 端末側の Google ログイン状態も消し、次回のログインでアカウント選択画面が出るようにする。失敗しても無視する。
export async function signOutOfNativeGoogle() {
  try {
    await bridge()?.nativePromise?.("SocialLogin", "logout", { provider: "google" });
  } catch {}
}
