// 複数の場所（サーバー、proxy）で読む Cookie の名前。proxy から読むので、重い依存を持たせない。
// 匿名利用者を識別する端末 Cookie（src/lib/auth.ts が発行する）。
export const DEVICE_COOKIE = "notefable_device";
// Auth.js のセッション Cookie。HTTPS では "__Secure-" が付き、大きいと ".0"、".1" … に分割される。
export const SESSION_COOKIE = "authjs.session-token";
