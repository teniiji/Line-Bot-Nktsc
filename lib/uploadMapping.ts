// The mapping a person confirmed in the preview, on its way back with the
// real upload.
//
// Sent as JSON in the form because it travels beside the file itself. It is
// read defensively: this decides which column becomes a member's ยอดหักไม่ได้,
// and a malformed value must fall back to reading the sheet again rather than
// to an index of NaN.

import { SHEET_FIELDS, type SheetField, type SheetMapping } from "./sheetColumns";

export interface ConfirmedUpload {
  mapping: SheetMapping;
  firstDataRow: number;
}

export function parseConfirmedUpload(
  mappingRaw: unknown,
  firstDataRowRaw: unknown
): ConfirmedUpload | null {
  if (typeof mappingRaw !== "string" || !mappingRaw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(mappingRaw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const mapping: SheetMapping = {};
  for (const { field } of SHEET_FIELDS) {
    const value = source[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) continue;
    mapping[field as SheetField] = value;
  }
  // Without a member number there is nothing to key a row on, so a mapping
  // missing it is not a mapping.
  if (mapping.memberNumber === undefined) return null;

  const firstDataRow = Number(firstDataRowRaw);
  return {
    mapping,
    firstDataRow:
      Number.isInteger(firstDataRow) && firstDataRow >= 0 ? firstDataRow : 0,
  };
}
