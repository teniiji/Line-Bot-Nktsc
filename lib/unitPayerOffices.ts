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
  // Which of them, as the unit holds their numbers — so staff can see who
  // the suggestion rests on before linking.
  matched: string[];
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
  const mine = new Map(unitMemberNumbers.map((n) => [key(n), n]));
  const size = new Map<string, number>();
  const matched = new Map<string, string[]>();
  for (const m of officeMembers) {
    size.set(m.office, (size.get(m.office) ?? 0) + 1);
    const own = mine.get(key(m.memberNumber));
    if (own !== undefined) matched.set(m.office, [...(matched.get(m.office) ?? []), own]);
  }
  return [...matched]
    .filter(([office]) => !linkedOffices.has(office))
    .map(([office, members]) => ({ office, overlap: members.length, size: size.get(office) ?? members.length, matched: members }))
    .sort((a, b) => b.overlap - a.overlap || a.office.localeCompare(b.office, "th"));
}

// Links worth making without asking, for every unit not linked yet: its best
// office by shared members, when nothing ties with it — and an office two
// units would both take goes to the one sharing more, or to neither on a tie.
// The units' members came from real transfers recorded for them, so one
// shared member already names the office (a member is at one office at a
// time); a tie is the case left for a person.
export function planAutoLinks(
  units: { payerId: string; memberNumbers: string[]; linked: boolean }[],
  officeMembers: OfficeMember[],
  linkedOffices: Set<string>
): (OfficeLink & { overlap: number })[] {
  const picks = units.flatMap((u) => {
    if (u.linked) return [];
    const [best, next] = officeSuggestions(u.memberNumbers, officeMembers, linkedOffices);
    if (!best || (next && next.overlap >= best.overlap)) return [];
    return [{ payerId: u.payerId, office: best.office, overlap: best.overlap }];
  });
  const byOffice = new Map<string, typeof picks>();
  for (const p of picks) byOffice.set(p.office, [...(byOffice.get(p.office) ?? []), p]);
  return [...byOffice.values()].flatMap((claims) => {
    const sorted = [...claims].sort((a, b) => b.overlap - a.overlap);
    return sorted.length === 1 || sorted[0].overlap > sorted[1].overlap ? [sorted[0]] : [];
  });
}
