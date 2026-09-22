// Reading the cooperative's หน่วยคุม list out of the file it keeps it in:
// two columns, code and name, with or without a heading row.
//
// Deliberately stricter than the round uploads, because this file is small
// and its shape is not in doubt — a row that does not read as a code and a
// name is reported rather than guessed at, so a wrong file says so instead
// of quietly replacing the names on screen with rubbish.

export interface ControlUnitRow {
  code: string;
  name: string;
}

export interface ControlUnitSheet {
  rows: ControlUnitRow[];
  // Rows that had something in them but no usable code and name: a heading,
  // a total, a stray note. Counted so a file read as half a list says so.
  skipped: number;
}

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const cell = value as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join("");
    if (typeof cell.text === "string") return cell.text;
    if (cell.result !== undefined && typeof cell.result !== "object") return String(cell.result);
    return "";
  }
  return String(value);
};

// The code as the files write it. Leading zeros go, because "01" and "1"
// would be two units on screen and one in every file that names them.
export function controlUnitCode(value: unknown): string | null {
  const raw = text(value).trim();
  if (!/^[0-9]+$/.test(raw)) return null;
  const code = raw.replace(/^0+/, "");
  return code.length > 0 ? code : null;
}

export function readControlUnitSheet(rows: unknown[][]): ControlUnitSheet {
  const seen = new Map<string, string>();
  let skipped = 0;

  for (const row of rows) {
    if (!row) continue;
    const code = controlUnitCode(row[0]);
    // Whitespace squeezed because the supplied file writes "ร.ร.จ่ายตรง  ร.ร.
    // ท่าบ่อ" with a double space, and the same unit typed again by hand
    // would not match it.
    const name = text(row[1]).replace(/\s+/g, " ").trim();

    if (!code || !name) {
      if (row.some((cell) => text(cell).trim())) skipped += 1;
      continue;
    }
    // The same code twice in one file is the file's problem, not the
    // table's: the last mention wins, and the row is counted once.
    seen.set(code, name);
  }

  return {
    rows: [...seen.entries()].map(([code, name]) => ({ code, name })),
    skipped,
  };
}
