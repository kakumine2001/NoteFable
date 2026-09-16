export function normalizeDatabaseSslMode(connectionString: string) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get("sslmode");

  // pg 8 の証明書・ホスト名検証を明示し、将来の既定動作変更を避ける。
  // 明示的な libpq 互換設定とローカルの非 TLS 接続はそのまま保持する。
  if (
    url.searchParams.get("uselibpqcompat") !== "true" &&
    mode &&
    ["prefer", "require", "verify-ca"].includes(mode)
  ) {
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  }

  return connectionString;
}
