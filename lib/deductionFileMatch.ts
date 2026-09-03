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
