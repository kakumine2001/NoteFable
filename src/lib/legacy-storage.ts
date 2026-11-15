// StudyMate から NoteFable への改名で、ブラウザに保存するキーの接頭辞を "studymate" から "notefable" に変えた。
// 古い名前で残っている値（ノートの下書き、モデルの選択など）は、最初に読む前に新しい名前へ移す。
const NEW_PREFIX = "notefable";
const OLD_PREFIX = "studymate";

export function adoptLegacyKey(storage: Storage, key: string) {
  if (!key.startsWith(NEW_PREFIX)) return;
  const legacy = OLD_PREFIX + key.slice(NEW_PREFIX.length);
  try {
    const old = storage.getItem(legacy);
    if (old === null) return;
    if (storage.getItem(key) === null) {
      try {
        storage.setItem(key, old);
      } catch {
        // 二つ目の写しを置く空きがない（容量いっぱい）。古い方を外して場所を空けてから入れ直し、それも駄目なら元に戻す。
        storage.removeItem(legacy);
        try {
          storage.setItem(key, old);
        } catch {
          storage.setItem(legacy, old);
        }
        return;
      }
    }
    storage.removeItem(legacy);
  } catch {
    // 使えないストレージ（プライベートモードなど）では何もしない。
  }
}
