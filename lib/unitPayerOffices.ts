// Linking an out-of-province office (from the cooperative's own list, see
// lib/outOfProvinceSheet.ts) to the unit whose name its transfers carry on
// the statement (lib/unitPayer.ts). Once linked, the unit knows every member
// that office deducts for, before a single transfer has had to be recorded.
//
// One rule keeps it honest, planned in one place: a member the link brought
// in (viaOffice) stays only while the link does and while the list still has
// them at that office. Anyone staff recorded or gave an amount (lastAmount)
// is theirs, never taken back.

import { memberNumberKey } from "./memberNumber";

export interface OfficeLink {
  payerId: string;
  office: string;
}

export interface OfficeMember {
  memberNumber: string;
  office: string;
}

export interface UnitMemberRow {
  id: string;
  payerId: string;
  memberNumber: string;
  viaOffice: string | null;
  lastAmount: number | null;
}

export interface OfficeSyncPlan {
  add: { payerId: string; memberNumber: string; viaOffice: string }[];
  remove: string[];
}

const key = (n: string) => memberNumberKey(n) ?? n;

export function planOfficeSync(
  links: OfficeLink[],
  officeMembers: OfficeMember[],
  unitMembers: UnitMemberRow[]
): OfficeSyncPlan {
  const officeOf = new Map(officeMembers.map((m) => [key(m.memberNumber), m.office]));
  const linked = new Set(links.map((l) => `${l.payerId}|${l.office}`));

  const remove = unitMembers
    .filter(
      (m) =>
        m.viaOffice !== null &&
        m.lastAmount === null &&
        (!linked.has(`${m.payerId}|${m.viaOffice}`) || officeOf.get(key(m.memberNumber)) !== m.viaOffice)
    )
    .map((m) => m.id);
  const removed = new Set(remove);
  const staying = new Set(
    unitMembers.filter((m) => !removed.has(m.id)).map((m) => `${m.payerId}|${key(m.memberNumber)}`)
  );

  const add: OfficeSyncPlan["add"] = [];
  for (const link of links) {
    for (const member of officeMembers) {
      if (member.office !== link.office) continue;
      const k = `${link.payerId}|${key(member.memberNumber)}`;
      if (staying.has(k)) continue;
      staying.add(k);
      add.push({ payerId: link.payerId, memberNumber: key(member.memberNumber), viaOffice: link.office });
    }
  }
  return { add, remove };
}

export interface OfficeSuggestion {
  office: string;
  // How many of the unit's own members the list has at this office.
  overlap: number;
  size: number;
}

// Offices worth linking to a unit: those holding members the unit is already
// known to pay for — the daily page learned them from real transfers, so an
// office they share is very likely the same payer. Offices linked anywhere
// are left out.
export function officeSuggestions(
  unitMemberNumbers: string[],
  officeMembers: OfficeMember[],
  linkedOffices: Set<string>
): OfficeSuggestion[] {
  const mine = new Set(unitMemberNumbers.map(key));
  const size = new Map<string, number>();
  const overlap = new Map<string, number>();
  for (const m of officeMembers) {
    size.set(m.office, (size.get(m.office) ?? 0) + 1);
    if (mine.has(key(m.memberNumber))) overlap.set(m.office, (overlap.get(m.office) ?? 0) + 1);
  }
  return [...overlap]
    .filter(([office]) => !linkedOffices.has(office))
    .map(([office, n]) => ({ office, overlap: n, size: size.get(office) ?? n }))
    .sort((a, b) => b.overlap - a.overlap || a.office.localeCompare(b.office, "th"));
}
