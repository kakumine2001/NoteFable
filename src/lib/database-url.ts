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

// NoteFable のテーブルを置く PostgreSQL の schema。接続文字列（DATABASE_URL）の schema 指定は使わず、常にこれにする。
export const DATABASE_SCHEMA = "notefable";

export function withDatabaseSchema(connectionString: string, schema = DATABASE_SCHEMA) {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schema);
  return url.toString();
}
