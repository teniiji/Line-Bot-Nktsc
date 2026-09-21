// Working out which column of an uploaded sheet is which.
//
// Every เขต builds its own file, and they do not agree. Two real ones, both
// uploaded into the same round:
//
//   รายการหักไม่ได้ บำนาญ (ชีต "หน่วย")
//     two title rows, then a header row, then
//     A ลำดับ · B เลขที่ · C ชื่อ สกุล · D แจ้งหัก · E หักได้ · F หักไม่ได้
//     G รหัสหน่วย · H สังกัด
//
//   0969 (ชีต "0969", 14,699 แถว)
//     no header row at all, and
//     A เลขสมาชิก · B ชื่อ · C ยอดแจ้งหัก · D รหัส · E สังกัด
//     F เลขประชาชน · G รหัสหน่วย · H,I สูตร MATCH ที่ค้างไว้
//
// Reading either by fixed position puts the ลำดับ in the member number, the
// member number in the name, and — the expensive one — ยอดหักได้ in the
// ยอดหักไม่ได้ column, which imported a whole district of people who had paid
// in full as owing their full deduction. ฿12,243,006 of it.
//
// So nothing here is assumed. The header row is found and read when there is
// one; failing that each column is judged by what is actually in it; and
// whatever this file works out, a person sees it beside the first few rows
// and can correct it before anything is written. Detection only has to be
// good enough to be worth confirming.

export type SheetField =
  | "memberNumber"
  | "name"
  | "expected"
  | "collected"
  | "uncollected"
  | "unitName"
  | "unitCode"
  | "hCode"
  | "accountNumber";

export const SHEET_FIELDS: { field: SheetField; label: string; required: boolean }[] = [
  { field: "memberNumber", label: "เลขสมาชิก", required: true },
  { field: "name", label: "ชื่อ-สกุล", required: false },
  { field: "expected", label: "ยอดแจ้งหัก", required: false },
  { field: "collected", label: "ยอดหักได้", required: false },
  { field: "uncollected", label: "ยอดหักไม่ได้", required: false },
  // Three columns of the ไฟล์รวม, three different things: the หน่วยคุม the
  // cooperative counts by (G), and the สังกัด inside it by code (D) and by
  // name (E).
  { field: "hCode", label: "หน่วยคุม", required: false },
  { field: "unitCode", label: "รหัสสังกัด", required: false },
  { field: "unitName", label: "ชื่อสังกัด", required: false },
  { field: "accountNumber", label: "เลขบัญชี", required: false },
];

export type SheetMapping = Partial<Record<SheetField, number>>;

// Header spellings seen in the files staff actually send. Matched on a
// squeezed form (spaces and punctuation removed) because "ชื่อ  สกุล",
// "ชื่อ-สกุล" and "ชื่อสกุล" are all the same heading.
const HEADER_WORDS: { field: SheetField; words: string[]; weak?: boolean }[] = [
  { field: "memberNumber", words: ["เลขที่", "เลขสมาชิก", "รหัสสมาชิก", "เลขทะเบียน"] },
  { field: "name", words: ["ชื่อสกุล", "ชื่อนามสกุล", "ชื่อ"] },
  { field: "uncollected", words: ["หักไม่ได้", "ยอดหักไม่ได้", "เก็บไม่ได้", "คงค้าง"] },
  { field: "collected", words: ["หักได้", "ยอดหักได้", "เก็บได้"] },
  // "สหกรณ์" is a heading in the เขต files, where the amount is split into
  // the cooperative's own share and the สสค. one beside it. It names the
  // share this round is about, so it wins over the combined total.
  { field: "expected", words: ["สหกรณ์", "แจ้งหัก", "ยอดแจ้งหัก", "ยอดเรียกเก็บ", "ยอดหัก"] },
  { field: "accountNumber", words: ["เลขบัญชี", "เลขที่บัญชี", "บัญชีธนาคาร"] },
  { field: "hCode", words: ["รหัสหน่วย", "หน่วยคุม", "รหัสหน่วยคุม", "รหัสหน่วยงาน"] },
  { field: "unitCode", words: ["รหัสสังกัด", "หน่วยสังกัด", "รหัสโรงเรียน"] },
  { field: "unitName", words: ["สังกัด", "หน่วยงาน", "โรงเรียน", "ชื่อหน่วย"] },
  // Only where nothing better was found: "รวม" is สหกรณ์ + สสค. together, and
  // "จำนวนเงิน" could be any of the columns in a sheet that has several.
  { field: "expected", words: ["รวม", "จำนวนเงิน"], weak: true },
];

// Columns that must never be mapped onto a field, however they look. The
// national ID is 13 digits of exactly the shape an account number detector
// would like, and it is the one column this system deliberately does not
// store — see parseMaiDaiSheet.
const EXCLUDED_WORDS = [
  "เลขประชาชน",
  "บัตรประชาชน",
  "เลขบัตรประชาชน",
  "เลขประจำตัวประชาชน",
  // Another organisation's money, collected on the same payroll line. It is
  // never this round's figure, and it sits in a column of amounts that a
  // detector would happily mistake for one.
  "สสค",
];

const squeeze = (value: string) => value.replace(/[\s\-_.()]/g, "");

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // ExcelJS hands back objects for formulas and rich text. A formula that
    // errored (#N/A on a leftover MATCH) carries nothing worth reading.
    const cell = value as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join("");
    if (typeof cell.text === "string") return cell.text;
    if (cell.result !== undefined && typeof cell.result !== "object") return String(cell.result);
    return "";
  }
  return String(value).trim();
};

const numberOf = (value: unknown): number | null => {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

// The header row is the first row in the first few that names at least two
// fields. Title banners above it ("สหกรณ์ออมทรัพย์ครู…", "รายการหักไม่ได้
// บำนาญ…") name none, so they are stepped over rather than guessed at.
export function findHeaderRow(rows: unknown[][], within = 10): number | null {
  for (let index = 0; index < Math.min(within, rows.length); index += 1) {
    const cells = (rows[index] ?? []).map((cell) => squeeze(text(cell)));
    const hits = new Set<SheetField>();
    for (const cell of cells) {
      if (!cell) continue;
      const hit = HEADER_WORDS.find((entry) => entry.words.some((word) => cell === word));
      if (hit) hits.add(hit.field);
    }
    if (hits.size >= 2) return index;
  }
  return null;
}

function mapFromHeader(header: unknown[]): SheetMapping {
  const mapping: SheetMapping = {};

  // The fallback words are held back to a second pass, so a sheet carrying
  // both "สหกรณ์" and "รวม" maps the cooperative's own column whichever order
  // they appear in.
  const pass = (entries: typeof HEADER_WORDS) => {
    header.forEach((cell, index) => {
      const value = squeeze(text(cell));
      if (!value || EXCLUDED_WORDS.some((word) => value.includes(word))) return;
      if (Object.values(mapping).includes(index)) return;
      // Longest match wins so "ยอดหักไม่ได้" is not taken by "หักได้", which
      // is a substring of it. Exact equality is tried first for the same
      // reason.
      const exact = entries.find((entry) => entry.words.some((word) => value === word));
      const loose =
        exact ??
        entries
          .slice()
          .sort(
            (a, b) =>
              Math.max(...b.words.map((w) => w.length)) -
              Math.max(...a.words.map((w) => w.length))
          )
          .find((entry) => entry.words.some((word) => value.includes(word)));
      if (loose && mapping[loose.field] === undefined) mapping[loose.field] = index;
    });
  };

  pass(HEADER_WORDS.filter((entry) => !entry.weak));
  pass(HEADER_WORDS.filter((entry) => entry.weak));
  return mapping;
}

interface ColumnStats {
  index: number;
  filled: number;
  numeric: number;
  textual: number;
  thai: number;
  distinct: number;
  digits13: number;
  digits9to12: number;
  smallInts: number;
  // Numbers of five or six digits. The cooperative's หน่วยคุม run from 1 to
  // 1200 — four digits at most, all 64 of them — so a code this long is a
  // รหัสสังกัด, whatever the heading above it says.
  longCodes: number;
  sequential: boolean;
  hasDecimals: boolean;
}

export function columnStats(rows: unknown[][], columns: number): ColumnStats[] {
  const stats: ColumnStats[] = [];
  for (let index = 0; index < columns; index += 1) {
    const values: string[] = [];
    let numeric = 0;
    let textual = 0;
    let thai = 0;
    let digits13 = 0;
    let digits9to12 = 0;
    let smallInts = 0;
    let longCodes = 0;
    let hasDecimals = false;
    const numbers: number[] = [];

    for (const row of rows) {
      const value = text(row?.[index]);
      if (!value) continue;
      values.push(value);
      const num = numberOf(value);
      if (num === null) {
        textual += 1;
        if (/[฀-๿]/.test(value)) thai += 1;
        continue;
      }
      numeric += 1;
      numbers.push(num);
      if (!Number.isInteger(num)) hasDecimals = true;
      const digits = value.replace(/\D/g, "").length;
      if (digits === 13) digits13 += 1;
      else if (digits >= 9 && digits <= 12) digits9to12 += 1;
      if (Number.isInteger(num) && num > 0 && digits <= 6) smallInts += 1;
      if (Number.isInteger(num) && num > 0 && digits >= 5 && digits <= 6) longCodes += 1;
    }

    // A ลำดับ column counts up by one down the page; a member number does not.
    let steps = 0;
    for (let i = 1; i < numbers.length; i += 1) {
      if (numbers[i] - numbers[i - 1] === 1) steps += 1;
    }

    stats.push({
      index,
      filled: values.length,
      numeric,
      textual,
      thai,
      distinct: new Set(values).size,
      digits13,
      digits9to12,
      smallInts,
      longCodes,
      sequential: numbers.length >= 5 && steps / (numbers.length - 1) > 0.8,
      hasDecimals,
    });
  }
  return stats;
}

// Best effort when the sheet has no header row — enough to be worth
// confirming, never enough to be trusted on its own. Amount columns are
// deliberately left unmapped here: แจ้งหัก, หักได้ and หักไม่ได้ are three
// columns of money that look identical to a detector, and guessing which is
// which is exactly the mistake that imported a district as unpaid.
function mapFromContent(rows: unknown[][], columns: number): SheetMapping {
  const stats = columnStats(rows, columns);
  const mapping: SheetMapping = {};
  const taken = new Set<number>();
  const take = (field: SheetField, index: number | undefined) => {
    if (index === undefined || taken.has(index)) return;
    mapping[field] = index;
    taken.add(index);
  };

  const dense = stats.filter((s) => s.filled >= Math.max(3, rows.length * 0.5));

  // Member number: small unique integers, and not the ลำดับ that counts up.
  const memberish = dense
    .filter((s) => !s.sequential && s.smallInts / Math.max(1, s.filled) > 0.8)
    .sort((a, b) => b.distinct / b.filled - a.distinct / a.filled);
  take("memberNumber", memberish[0]?.index);

  // Name: Thai text, nearly all different.
  const names = dense
    .filter((s) => s.thai / Math.max(1, s.filled) > 0.7 && s.distinct / s.filled > 0.8)
    .sort((a, b) => a.index - b.index);
  take("name", names[0]?.index);

  // สังกัด: Thai text that repeats — a school name covers many members.
  const units = dense
    .filter((s) => s.thai / Math.max(1, s.filled) > 0.7 && s.distinct / s.filled < 0.5)
    .sort((a, b) => a.distinct - b.distinct);
  take("unitName", units[0]?.index);

  // The two codes a member carries, told apart by how coarse they are. In
  // the ไฟล์รวม the หน่วยคุม repeats hardest — 64 values over 7,000 rows —
  // and the รหัสสังกัด beneath it has hundreds, so the coarsest column is the
  // หน่วยคุม and the next one down is its สังกัด.
  //
  // Only on a file long enough for "repeats a lot" to mean anything: on a
  // unit's sheet of six members a column of identical amounts looks exactly
  // the same, so nothing is claimed there. And the สังกัด is only claimed
  // when it is clearly finer, because a file that writes the หน่วยคุม twice
  // (0869 carries it in both F and J) would otherwise have the duplicate
  // read as a สังกัด it never named.
  if (rows.length >= 20) {
    const codes = dense
      .filter(
        (s) =>
          !s.sequential &&
          !s.hasDecimals &&
          s.smallInts / Math.max(1, s.filled) > 0.9 &&
          s.distinct >= 2 &&
          // Repeats at least three times over on average. Looser than the
          // หน่วยคุม below, because the สังกัด code is much finer — 656
          // values in the ไฟล์รวม against the หน่วยคุม's 64.
          s.distinct <= s.filled / 3
      )
      .sort((a, b) => a.distinct - b.distinct);

    // Five- and six-digit numbers are longer than any หน่วยคุม the
    // cooperative has, so however hard they repeat they are สังกัด codes —
    // see ColumnStats.longCodes.
    const isUnitCode = (s: ColumnStats) => s.longCodes / Math.max(1, s.filled) >= 0.7;
    // The หน่วยคุม also has to repeat hard to be claimed at all; a column
    // that merely repeats is not evidence enough to label a grouping by.
    const unit = codes.find((s) => !isUnitCode(s) && s.distinct <= s.filled / 10);
    take("hCode", unit?.index);

    // Its สังกัด: a code column that is either plainly one by its length, or
    // is clearly finer than the หน่วยคุม. The second test matters because a
    // file that writes the หน่วยคุม twice (0869 carries it in both F and J)
    // would otherwise have the duplicate read as a สังกัด it never named.
    const sub = codes.find(
      (s) => s.index !== unit?.index && (isUnitCode(s) || (unit && s.distinct >= unit.distinct * 2))
    );
    take("unitCode", sub?.index);
  }

  // Ten-ish digits and not the national ID's thirteen.
  const accounts = dense
    .filter((s) => s.digits13 === 0 && s.digits9to12 / Math.max(1, s.filled) > 0.6)
    .sort((a, b) => b.digits9to12 - a.digits9to12);
  take("accountNumber", accounts[0]?.index);

  return mapping;
}

// A heading names a column; what is in it decides what the column is.
//
// "หน่วยคุม" and "รหัสหน่วย" sit over three different things in the files
// staff send: the หน่วยคุม itself, the name of the สังกัด, and — in the unit
// files — the สังกัด's own code (520001, 13003). Only the first is a
// หน่วยคุม, and a round that takes the other two for one offers hundreds of
// หน่วยคุม that the cooperative does not have.
function placeCodeColumn(
  mapping: SheetMapping,
  body: unknown[][],
  columns: number
): SheetMapping {
  const index = mapping.hCode;
  if (index === undefined) return mapping;

  const stats = columnStats(body, columns)[index];
  if (!stats || stats.filled === 0) return mapping;

  const move = (field: "unitName" | "unitCode") => {
    if (mapping[field] !== undefined) return mapping;
    const moved = { ...mapping, [field]: index };
    delete moved.hCode;
    return moved;
  };

  // Thai text under a code heading is the สังกัด's name.
  if (stats.thai / stats.filled >= 0.7) return move("unitName");
  // Five or six digits is longer than any หน่วยคุม the cooperative has, so
  // it is the รหัสสังกัด — see ColumnStats.longCodes.
  if (stats.longCodes / stats.filled >= 0.7) return move("unitCode");
  return mapping;
}

export interface SheetReading {
  // Index of the header row, or null when the sheet has none.
  headerRow: number | null;
  // Where the data starts, whether or not there was a header.
  firstDataRow: number;
  mapping: SheetMapping;
  fromHeader: boolean;
}

export function detectSheetColumns(rows: unknown[][]): SheetReading {
  const headerRow = findHeaderRow(rows);
  const columns = Math.max(0, ...rows.slice(0, 50).map((row) => row?.length ?? 0));

  if (headerRow !== null) {
    const mapping = mapFromHeader(rows[headerRow] ?? []);
    if (mapping.memberNumber !== undefined) {
      const body = rows.slice(headerRow + 1, headerRow + 201);
      return {
        headerRow,
        firstDataRow: headerRow + 1,
        mapping: placeCodeColumn(mapping, body, columns),
        fromHeader: true,
      };
    }
  }

  // No usable header: skip any banner rows before judging the content, so a
  // title spanning eight columns does not count as data.
  const firstDataRow = headerRow === null ? firstFilledRow(rows) : headerRow + 1;
  // A wide sample, because these files are written unit by unit: the first
  // 200 rows of the ไฟล์รวม are nearly all one สังกัด, where the รหัสสังกัด
  // and the หน่วยคุม above it are equally repetitive and indistinguishable.
  // Over 2,000 rows they separate — 288 สังกัด against 19 หน่วยคุม.
  const body = rows.slice(firstDataRow, firstDataRow + 2000);
  return {
    headerRow,
    firstDataRow,
    mapping: mapFromContent(body, columns),
    fromHeader: false,
  };
}

// The first row that reads as data rather than as a banner: a banner repeats
// one string across its cells, which is how a merged title arrives.
function firstFilledRow(rows: unknown[][]): number {
  for (let index = 0; index < Math.min(10, rows.length); index += 1) {
    const cells = (rows[index] ?? []).map((cell) => text(cell)).filter(Boolean);
    if (cells.length === 0) continue;
    if (new Set(cells).size === 1 && cells.length > 2) continue;
    return index;
  }
  return 0;
}

// What to show beside the mapping so a person can check it: the letter, and
// the first values actually in that column.
export interface ColumnSample {
  index: number;
  letter: string;
  header: string | null;
  samples: string[];
}

export function columnSamples(rows: unknown[][], reading: SheetReading): ColumnSample[] {
  const columns = Math.max(0, ...rows.slice(0, 50).map((row) => row?.length ?? 0));
  const body = rows.slice(reading.firstDataRow, reading.firstDataRow + 5);
  const header = reading.headerRow === null ? null : rows[reading.headerRow];

  const out: ColumnSample[] = [];
  for (let index = 0; index < columns; index += 1) {
    out.push({
      index,
      letter: columnLetter(index),
      header: header ? text(header[index]) || null : null,
      samples: body.map((row) => text(row?.[index])).filter(Boolean).slice(0, 3),
    });
  }
  return out;
}

export function columnLetter(index: number): string {
  let value = index;
  let letter = "";
  do {
    letter = String.fromCharCode(65 + (value % 26)) + letter;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letter;
}

export const readCell = text;
export const readNumber = numberOf;
