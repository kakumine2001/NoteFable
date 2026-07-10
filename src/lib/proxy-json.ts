export function stringifyJsonForProxy(value: unknown) {
  // 互換プロキシで非 ASCII 文字が壊れないよう、JSON の文字列を ASCII 表現へ寄せる。
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
