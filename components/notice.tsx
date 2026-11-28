import type { ReactNode } from "react";

export type NoticeTone = "error" | "success" | "warning" | "info" | "waiting";

const toneStyle: Record<NoticeTone, string> = {
  error: "border-red-900 bg-red-50 text-red-950",
  success: "border-green-900 bg-green-50 text-green-950",
  warning: "border-amber-900 bg-amber-50 text-amber-950",
  info: "border-sky-900 bg-sky-50 text-sky-950",
  waiting: "border-amber-900 bg-amber-50 text-amber-950",
};

const toneLabel: Record<NoticeTone, string> = {
  error: "Error",
  success: "Saved",
  warning: "Check",
  info: "Note",
  waiting: "Waiting",
};

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
  if (tone === "success") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M7.5 12.5 10.5 15.5 16.5 8.5" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (tone === "info") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 11v6" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="8" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "waiting") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3 2 20h20L12 3Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border-2 px-3 py-3 text-lg font-medium leading-7 ${toneStyle[tone]}`}
    >
      <span className="mt-0.5 shrink-0">
        <NoticeIcon tone={tone} />
      </span>
      <span>
        <span className="font-semibold">{toneLabel[tone]}. </span>
        {children}
      </span>
    </p>
  );
}
