// Suggests a member number for a LINE contact who never went through
// submit_member_info's identity step, by matching what they typed as their
// name (LineUser.fullName) against the ชื่อ-นามสกุล column of every เก็บไม่ได้
// round they could plausibly appear on (StatementMember — the same table the
// line-notify workflow reads to message these members in the first place).
//
// Deliberately a *suggestion*, never a write: the caller still has to send
// it through the same PUT /api/line-users/:id that a staff-typed number goes
// through, so it lands exactly as "ยังไม่ยืนยัน" as any other staff entry —
// this only saves the typing, not the trust level.
//
// Only ever proposes a match when exactly one member number carries that
// name. Two different people can share a name; guessing between them would
// be worse than leaving the cell blank, which is why a tie returns nothing
// rather than a first-found pick.

export interface NameCandidate {
  memberNumber: string;
  name: string;
}

// Full names arrive with inconsistent spacing — "นาง พิศวง พรหมจรรย์" from one
// person, "นางพิศวง พรหมจรรย์" from a spreadsheet, "นางพิศวง  พรหมจรรย์" from
// a third — none of it meaningful. Stripping all whitespace before comparing
// treats those as the same name without having to guess where a space
// belongs.
function squeeze(name: string): string {
  return name.replace(/\s+/g, "");
}

// One name index built once per request and reused for every row on the
// page that needs a suggestion, rather than re-scanning the candidate list
// per row.
export type NameIndex = Map<string, NameCandidate[]>;

export function buildNameIndex(candidates: NameCandidate[]): NameIndex {
  const index: NameIndex = new Map();
  for (const candidate of candidates) {
    const key = squeeze(candidate.name);
    if (!key) continue;
    const existing = index.get(key);
    if (!existing) {
      index.set(key, [candidate]);
    } else if (!existing.some((c) => c.memberNumber === candidate.memberNumber)) {
      // Same name, different member numbers across rounds — a real
      // collision, not the same person reappearing next month.
      existing.push(candidate);
    }
  }
  return index;
}

export function suggestMemberByName(
  fullName: string | null,
  index: NameIndex
): NameCandidate | null {
  if (!fullName) return null;
  const key = squeeze(fullName);
  if (!key) return null;
  const matches = index.get(key);
  if (!matches || matches.length !== 1) return null;
  return matches[0];
}
