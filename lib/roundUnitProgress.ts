import { controlUnitName } from "./controlUnits";

// Which หน่วยคุม of a round have sent their ผลการหัก back, one row each — for
// staff asking "which units have we uploaded already?". The round page said
// only how many were still out (lib/roundMembers.ts refreshRoundProgress), so
// finding which ones meant scrolling 7,000 members for ⏳ รอผลการหัก.
//
// Grouped the way that count is: by หน่วยคุม where a member has one, else by
// the unit's own name. A unit has reported when none of its members is still
// awaiting; "partial" is a หน่วยคุม some of whose offices have sent results
// and some not — the offices still out are listed so staff know whom to ask.

export interface MemberResult {
  hCode: string | null;
  unitName: string | null;
  deductionResult: string;
}

export type UnitState = "reported" | "partial" | "awaiting";

export interface UnitProgressRow {
  key: string;
  hCode: string | null;
  name: string;
  members: number;
  collected: number;
  uncollected: number;
  awaiting: number;
  state: UnitState;
  // The offices under this หน่วยคุม with somebody still awaiting a result.
  awaitingUnitNames: string[];
}

const STATE_ORDER: Record<UnitState, number> = { awaiting: 0, partial: 1, reported: 2 };

export function unitProgress(members: MemberResult[]): UnitProgressRow[] {
  const rows = new Map<string, UnitProgressRow & { awaitingNames: Set<string> }>();
  for (const m of members) {
    const key = m.hCode ?? m.unitName;
    if (!key) continue;
    const row =
      rows.get(key) ??
      {
        key,
        hCode: m.hCode,
        name: (m.hCode && controlUnitName(m.hCode)) ?? m.unitName ?? key,
        members: 0,
        collected: 0,
        uncollected: 0,
        awaiting: 0,
        state: "reported" as UnitState,
        awaitingUnitNames: [],
        awaitingNames: new Set<string>(),
      };
    row.members += 1;
    if (m.deductionResult === "awaiting") {
      row.awaiting += 1;
      if (m.unitName) row.awaitingNames.add(m.unitName);
    } else if (m.deductionResult === "collected") row.collected += 1;
    else row.uncollected += 1;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map(({ awaitingNames, ...row }) => ({
      ...row,
      state: (row.awaiting === 0 ? "reported" : row.awaiting === row.members ? "awaiting" : "partial") as UnitState,
      awaitingUnitNames: [...awaitingNames].sort((a, b) => a.localeCompare(b, "th")),
    }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.key.localeCompare(b.key, "th", { numeric: true })
    );
}
