export function StudyMateLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--notion-border-strong)] bg-white text-[var(--notion-text)] shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
        <svg width="20" height="20" viewBox="0 0 32 32" role="img" aria-label="StudyMate">
          <path d="M6.5 7.8c0-1.4 1.2-2.5 2.6-2.2L16 6.8v19L9.4 24.6a3.5 3.5 0 0 1-2.9-3.4V7.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M25.5 7.8c0-1.4-1.2-2.5-2.6-2.2L16 6.8v19l6.6-1.2a3.5 3.5 0 0 0 2.9-3.4V7.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M16 7.2v18" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      {!compact && <span className="truncate text-sm font-semibold text-[var(--notion-text)]">StudyMate</span>}
    </div>
  );
}
