// Small-group suppression for one table. A cell whose learner count is below
// the center minimum is replaced with "<" plus that minimum. The default
// minimum is 5, which prints as "<5".
//
// Complementary suppression: if the table total is published and exactly one
// cell is hidden, a reader can subtract the visible cells from the total and
// recover the hidden count. This hides one more cell, the smallest remaining
// one, so subtraction yields only a combined remainder.
//
// This does not close every path. A later export with an overlapping date
// range can be subtracted from this one. Someone who already knows one hidden
// cell can learn the other. The report text says so. Do not describe this
// step as removing re-identification risk.

import type { ExportFigure } from "./types";

export type CountCell = { key: string; count: number };

export function suppressionLabel(min: number): string {
  return `<${min}`;
}

export function hideCount(count: number, min: number): ExportFigure {
  return count < min ? suppressionLabel(min) : count;
}

/// True only when both `part` and the people who are not in `part` are at
/// least the minimum. A remainder of zero is still a count of zero, and zero
/// is below every supported minimum, so 0% and 100% stay hidden.
export function partCanBePublished(part: number, total: number, min: number): boolean {
  if (!Number.isInteger(part) || !Number.isInteger(total) || part < 0 || total < part) return false;
  if (part < min || total < min) return false;
  return total - part >= min;
}

export function suppressCells(cells: readonly CountCell[], min: number): Map<string, ExportFigure> {
  const label = suppressionLabel(min);
  const present = cells.filter((cell) => cell.count > 0);
  const hidden = new Set(present.filter((cell) => cell.count < min).map((cell) => cell.key));
  if (hidden.size === 1) {
    const visible = present
      .filter((cell) => !hidden.has(cell.key))
      .sort((a, b) => a.count - b.count || a.key.localeCompare(b.key));
    const extra = visible[0];
    if (extra) hidden.add(extra.key);
  }
  const out = new Map<string, ExportFigure>();
  for (const cell of present) out.set(cell.key, hidden.has(cell.key) ? label : cell.count);
  return out;
}
