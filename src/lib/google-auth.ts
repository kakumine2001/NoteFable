import NextAuth from "next-auth";
import type { Account, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { optionalEnv } from "@/lib/env";

// Google ログインに必要な環境変数がそろっているか。未設定でも匿名利用はそのまま動かす。
export function isGoogleLoginConfigured() {
  return Boolean(
    optionalEnv("AUTH_SECRET") && optionalEnv("AUTH_GOOGLE_ID") && optionalEnv("AUTH_GOOGLE_SECRET"),
  );
}

// token.sub は DB adapter が無いとログインのたびに作り直される値なので、利用者の特定には使えない。
// Google のアカウント ID（providerAccountId）を別のキーに保存し、これを DB の googleSub と対応させる。
export const authCallbacks = {
  jwt({ token, account }: { token: JWT; account?: Account | null }) {
    if (account?.provider === "google" && account.providerAccountId) {
      token.googleSub = account.providerAccountId;
    }
    return token;
  },
  session({ session, token }: { session: Session; token: JWT }) {
    if (session.user && typeof token.googleSub === "string") {
      session.user.id = token.googleSub;
    }
    return session;
  },
};

// セッションは JWT Cookie に持たせる。利用者データは AnonymousUser 側に保存するので DB adapter は使わない。
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: authCallbacks,
});
