"use client";

import { secondaryButtonClass } from "./ui";

export function PrintButton() {
  return (
    <button className={`${secondaryButtonClass} print:hidden`} type="button" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
