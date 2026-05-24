export function StudyMateLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#f7f6f2] shadow-sm ring-1 ring-slate-200">
        <svg
          width="30"
          height="30"
          viewBox="0 0 48 48"
          role="img"
          aria-label="StudyMate"
          className="text-slate-950"
        >
          <path
            d="M12.5 8.5 32 5.8c3.1-.4 5.5 1.5 5.5 4.4v26.2c0 2.4-1.7 4.5-4.1 4.8L18.8 43c-3.7.5-6.8-2.4-6.8-6.1V12.1c0-1.8 1.3-3.3 3.1-3.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M14.2 12.7 34 9.9c1.6-.2 2.9.4 3.4 1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M12.4 17.2 31 14.7c3.5-.5 6.5 2.3 6.5 5.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M22 21.2h11.2v7.6H22z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M18.2 33.4v10l3.4-2.3 3.5 1.5v-9.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17.2 30.5h2.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {!compact && (
        <div className="text-lg font-bold leading-none">
          <span className="text-slate-950">Study</span>
          <span className="text-teal-600">Mate</span>
        </div>
      )}
    </div>
  );
}
