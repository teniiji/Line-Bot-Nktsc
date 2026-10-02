// Matches a bulk-selected file's name to one of a round's unit names, so
// staff can select every file for a round in one picker instead of hunting
// down each unit's upload button individually (previously ~60 separate
// click → find file → confirm cycles). Deliberately conservative: an
// ambiguous filename is left unmatched rather than guessed, since a wrong
// guess here means one unit's deduction file silently goes to another unit.

function normalize(name: string): string {
  return name
    .replace(/\.(xlsx|xls)$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MIN_SUBSTRING_LENGTH = 4;

export function matchFileNameToUnit(fileName: string, unitNames: string[]): string | null {
  const norm = normalize(fileName);
  if (!norm) return null;

  const exact = unitNames.find((u) => normalize(u) === norm);
  if (exact) return exact;

  // A unit name often appears as a substring of the file name (whoever
  // exported it added a date, a "รายการหัก" prefix, etc.) or vice versa.
  // Only trust this when exactly one unit qualifies — with more than one
  // (e.g. one unit's name is a prefix of another's), guessing risks
  // sending someone else's members' data to the wrong unit.
  const candidates = unitNames.filter((u) => {
    const un = normalize(u);
    return un.length >= MIN_SUBSTRING_LENGTH && (norm.includes(un) || un.includes(norm));
  });

  return candidates.length === 1 ? candidates[0] : null;
}

// ---------------------------------------------------------------------------
// Whole folders at once. Staff keep each unit's รายการหัก in a folder of its
// own, one subfolder per month ({หน่วยงาน}/0969/…), so a file picker that
// takes files from a single folder made them open a hundred folders one at a
// time. Dropping (or choosing) the whole tree hands over every file with the
// path it came from, and the path names the unit even where the file name
// does not.

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// What stays the same about a file or folder name from one month to the
// next: the name without its extension, its month and its year. "รายการหัก
// สพป นค เขต 2 เดือน สิงหาคม 2569" and "… กันยายน 2569" give the same key,
// and เขต 1 / เขต 2 still differ — only numbers of four digits or more (a
// year, an MMYY code, a date) are dropped.
export function aliasKey(name: string): string {
  let key = normalize(name);
  for (const month of THAI_MONTHS) key = key.split(month).join(" ");
  return key
    .replace(/\d{4,}/g, " ")
    .replace(/เดือน/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A folder that says nothing about which unit: the month folder ("0969",
// "09-69"), or one named only for the job itself.
const GENERIC_FOLDERS = new Set(["รายการหัก", "ไฟล์รายการหัก", "ส่งหน่วยงาน", "หน่วยงาน"]);
export function isGenericFolder(name: string): boolean {
  const key = aliasKey(name);
  return !key || /^[\d\s.\-/]*$/.test(normalize(name)) || GENERIC_FOLDERS.has(key);
}

// Files nobody means to send: Excel's own lock files ("~$…"), and anything
// that is not a workbook.
export function isDeductionWorkbook(name: string): boolean {
  return /\.(xlsx|xls)$/i.test(name) && !name.startsWith("~$") && !name.startsWith(".");
}

// Of a whole tree, the files for this round: where any sit under a folder
// named for the round's MMYY code, only those — the folder holds every
// earlier month too.
export function filesForPeriod<T extends { path: string }>(files: T[], period: string): T[] {
  const inPeriod = files.filter((f) => f.path.split("/").slice(0, -1).includes(period));
  return inPeriod.length > 0 ? inPeriod : files;
}

export type MatchVia = "remembered" | "file" | "folder";

export interface FolderFileMatch {
  unitName: string | null;
  via: MatchVia | null;
  // The names whose keys taught this match, to remember once it is used.
  keys: string[];
}

// Which unit one file belongs to, by — in order — the file's own name, what
// was chosen for the same name before, then each folder above it from the
// nearest up. A file that names its unit outright is believed over memory:
// a name remembered from one upload ("ไฟล์หัก.xlsx" for one unit) must not
// pull next month's file of the same name away from the unit it names.
export function matchFolderFile(
  path: string,
  unitNames: string[],
  remembered: Map<string, string>
): FolderFileMatch {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? path;
  const folders = parts.slice(0, -1).reverse().filter((f) => !isGenericFolder(f));
  const known = new Set(unitNames);
  const keys = [aliasKey(fileName), ...folders.map(aliasKey)].filter(Boolean);

  const byFile = matchFileNameToUnit(fileName, unitNames);
  if (byFile) return { unitName: byFile, via: "file", keys };
  for (const key of keys) {
    const unit = remembered.get(key);
    if (unit && known.has(unit)) return { unitName: unit, via: "remembered", keys };
  }
  for (const folder of folders) {
    const byFolder = matchFileNameToUnit(folder, unitNames);
    if (byFolder) return { unitName: byFolder, via: "folder", keys };
  }
  return { unitName: null, via: null, keys };
}

// What to remember from an upload, so next month's files match on their
// own. A key is kept only where it points at one unit across everything
// uploaded together: a folder holding several units' files, or a file name
// every unit shares ("รายการหัก 0969.xlsx"), names none of them.
export function keysToRemember(
  rows: { keys: string[]; unitName: string | null }[]
): { key: string; unitName: string }[] {
  const unitsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.unitName) continue;
    for (const key of row.keys) {
      if (key.length < MIN_SUBSTRING_LENGTH || GENERIC_FOLDERS.has(key)) continue;
      const set = unitsOf.get(key) ?? new Set<string>();
      set.add(row.unitName);
      unitsOf.set(key, set);
    }
  }
  // Keys that also turn up on a file left unmatched are not safe either.
  for (const row of rows) {
    if (row.unitName) continue;
    for (const key of row.keys) unitsOf.get(key)?.add("");
  }
  return [...unitsOf]
    .filter(([, units]) => units.size === 1)
    .map(([key, units]) => ({ key, unitName: [...units][0] }));
}
