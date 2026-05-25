export function requireEnv(name: string) {
  // 必須環境変数を取得する。空文字や空白だけの場合も未設定として扱う。
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function optionalEnv(name: string) {
  // 任意環境変数を取得する。未設定や空文字は undefined に統一する。
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getCookieSecret() {
  // Cookie 署名用の秘密値。production では必ず明示設定させる。
  const secret = optionalEnv("COOKIE_SECRET");

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("COOKIE_SECRET is not configured.");
  }

  return "studymate-dev-cookie-secret";
}
