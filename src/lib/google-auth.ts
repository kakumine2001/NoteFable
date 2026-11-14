import NextAuth from "next-auth";
import type { Account, Profile, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { isAuthoritativeGoogleEmail } from "@/lib/email-address";
import { optionalEnv } from "@/lib/env";

// Google ログインに必要な環境変数がそろっているか。未設定でも匿名利用はそのまま動かす。
export function isGoogleLoginConfigured() {
  return Boolean(
    optionalEnv("AUTH_SECRET") && optionalEnv("AUTH_GOOGLE_ID") && optionalEnv("AUTH_GOOGLE_SECRET"),
  );
}

// メールの確認コードでのログインに必要な設定。本番は送信サービスの鍵と差出人が要る。開発中は鍵が無くてもコードをサーバーのログに出す。
export function isEmailLoginConfigured() {
  if (!optionalEnv("AUTH_SECRET")) return false;
  if (optionalEnv("RESEND_API_KEY") && optionalEnv("EMAIL_FROM")) return true;
  return process.env.NODE_ENV !== "production";
}

// どちらかのログインが使えるか。ログイン Cookie（Auth.js の JWT）を読むかどうかはこれで決める。
export function isAccountLoginConfigured() {
  return isGoogleLoginConfigured() || isEmailLoginConfigured();
}

declare module "next-auth" {
  interface Session {
    // メールの確認コードでログインしたときのアドレス（小文字）。Google ログインでは undefined。
    loginEmail?: string;
    // Google のアドレスが Gmail / Workspace の確認済みアドレスか。そのときだけ、同じアドレスのメールログインの利用者とまとめる。
    googleEmailVerified?: boolean;
  }
}

// token.sub は DB adapter が無いとログインのたびに作り直される値なので、利用者の特定には使えない。
// Google のアカウント ID（providerAccountId）を別のキーに保存し、これを DB の googleSub と対応させる。
export const authCallbacks = {
  jwt({ token, account, profile }: { token: JWT; account?: Account | null; profile?: Profile }) {
    if (account?.provider === "google" && account.providerAccountId) {
      token.googleSub = account.providerAccountId;
      // Gmail / Workspace の確認済みアドレスだけ（email-address.ts の isAuthoritativeGoogleEmail）。
      token.googleEmailVerified = isAuthoritativeGoogleEmail(profile?.email, profile?.email_verified, profile?.hd);
    }
    return token;
  },
  session({ session, token }: { session: Session; token: JWT }) {
    if (session.user && typeof token.googleSub === "string") {
      session.user.id = token.googleSub;
      session.googleEmailVerified = token.googleEmailVerified === true;
    } else if (typeof token.loginEmail === "string") {
      session.loginEmail = token.loginEmail;
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
