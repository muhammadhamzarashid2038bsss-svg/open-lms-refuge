import type { ReactNode } from "react";

export function Shell({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 bg-white px-4 py-8 text-zinc-950">
      <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
      {lede ? <p className="text-lg leading-7">{lede}</p> : null}
      {children}
    </main>
  );
}

export const buttonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-zinc-950 px-4 text-lg font-medium text-white disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg border-2 border-zinc-950 bg-white px-4 text-lg font-medium text-zinc-950";

export const inputClass =
  "min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg text-zinc-950";

export const labelClass = "flex flex-col gap-2 text-base font-medium";
