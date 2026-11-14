// NoteFable のロゴマーク（ノートとしおり）。紹介ページ・ワークスペース・アプリアイコンで同じ形を使う。
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="12 5 44 56" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path strokeWidth="3.2" d="M18 12.5 43 9c4-.6 7 2 7 5.7v34c0 3.1-2.2 5.8-5.2 6.2L26 57.2c-4.8.6-8.8-3.1-8.8-7.9V17.1c0-2.3 1.7-4.3 4-4.6Z" />
      <path strokeWidth="2.8" d="M20.2 18 45.5 14.4c2-.3 3.8.5 4.5 2.1M18 23.8 42 20.5c4.6-.6 8.3 3 8.3 7.6M30 29h14v9.5H30zM25.2 44v12.7l4.4-3 4.5 2V43.4M24 40.1h2.8" />
    </svg>
  );
}

export function StudyMateLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="sm-logo" role="img" aria-label="NoteFable">
      <BrandMark size={20} />
      {!compact && <span aria-hidden="true">NoteFable</span>}
    </div>
  );
}
