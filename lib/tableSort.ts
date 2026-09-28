// Sorting a table by a clicked column heading. Numbers compare as numbers —
// member numbers too, whether stored as text or not — Thai text in Thai
// order, and blanks always last whichever way the column is turned.

export type SortDir = "asc" | "desc";

type Cell = string | number | null | undefined;

const isBlank = (v: Cell) => v === null || v === undefined || v === "";

export function compareCells(a: Cell, b: Cell, dir: SortDir): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;
  const sign = dir === "asc" ? 1 : -1;
  const na = typeof a === "number" ? a : /^\d+(\.\d+)?$/.test(String(a)) ? Number(a) : NaN;
  const nb = typeof b === "number" ? b : /^\d+(\.\d+)?$/.test(String(b)) ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return sign * (na - nb);
  return sign * String(a).localeCompare(String(b), "th", { numeric: true });
}

export function sortRows<T>(rows: T[], cell: (row: T) => Cell, dir: SortDir): T[] {
  return [...rows].sort((x, y) => compareCells(cell(x), cell(y), dir));
}
