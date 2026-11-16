import { currentAccountProfile, getOrCreateUser, isAccountUser } from "@/lib/auth";
import { isAccountLoginConfigured } from "@/lib/google-auth";

// 購読はログインした利用者だけ。匿名の行（削除したアカウントの古い Cookie を含む）は null。
export async function signedInUser() {
  if (!isAccountLoginConfigured()) return null;
  const profile = await currentAccountProfile().catch(() => null);
  if (!profile) return null;
  const row = await getOrCreateUser();
  return isAccountUser(row) ? row : null;
}

// 決済画面から戻る先。Vercel では要求の URL がそのまま公開のドメインになる。
export function requestOrigin(request: Request) {
  return new URL(request.url).origin;
}
