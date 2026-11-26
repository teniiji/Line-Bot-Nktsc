// The coverage tab's picture of today: the yearly file, with the applications
// and cancellations recorded since (lib/enrollment.ts) laid over it.
//
// An application counts from its application date, as the cooperative
// decided, so a pending one counts too; a rejected one does not. Only those
// made after the file's date are applied — the file already holds the rest.
// Applied in date order, so an application then a cancellation leaves the
// member out.

import type { CoverageInput } from "./coverage";

export interface EnrollmentEvent {
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  age: number | null;
  product: string;
  action: string;
  status: string;
  applicationDate: Date;
  insuredSum: number | null;
  annualPremium: number | null;
}

// What happened to a member since the file, shown beside them.
export interface CoverageChange {
  product: string;
  action: string;
  status: string;
  date: string;
}

export type WithChanges<T> = T & {
  changes: CoverageChange[];
  // Not in the yearly file at all: their shares and debt are unknown until
  // the next file.
  notInFile: boolean;
};

const ASSOC_FLAG = { sok: "hasSok", scs: "hasScs", sst: "hasSst", ssk: "hasSsk" } as const;

export function applyEnrollments(
  members: CoverageInput[],
  events: EnrollmentEvent[],
  since: Date
): WithChanges<CoverageInput>[] {
  const byMember = new Map<string, WithChanges<CoverageInput>>(
    members.map((m) => [m.memberNumber, { ...m, changes: [], notInFile: false }])
  );

  const applicable = events
    .filter((e) => e.status !== "rejected" && e.applicationDate.getTime() > since.getTime())
    .sort((a, b) => a.applicationDate.getTime() - b.applicationDate.getTime());

  for (const e of applicable) {
    let m = byMember.get(e.memberNumber);
    if (!m) {
      // A cancellation for someone the file does not hold changes nothing.
      if (e.action !== "enroll") continue;
      m = {
        memberNumber: e.memberNumber,
        memberName: e.memberName,
        unitName: e.unitName,
        gender: null,
        age: e.age,
        sharePeriods: null,
        shares: 0,
        debt: null,
        insuredSum: 0,
        premium: 0,
        premiumDeducted: null,
        hasSok: false,
        hasScs: false,
        hasSst: false,
        hasSsk: false,
        relativeCount: 0,
        relativeFees: 0,
        debtStatus: "ยังไม่มีในไฟล์ประกัน (สมัครใหม่)",
        undeducted: null,
        changes: [],
        notInFile: true,
      };
      byMember.set(e.memberNumber, m);
    }

    const enroll = e.action === "enroll";
    if (e.product === "life") {
      if (enroll && m.insuredSum === 0) {
        m.insuredSum = e.insuredSum ?? 0;
        m.premium = e.annualPremium ?? 0;
        m.premiumDeducted = null;
      } else if (!enroll) {
        m.insuredSum = 0;
        m.premium = 0;
        m.premiumDeducted = null;
      }
    } else if (e.product in ASSOC_FLAG) {
      m[ASSOC_FLAG[e.product as keyof typeof ASSOC_FLAG]] = enroll;
    } else if (e.product === "relative") {
      m.relativeCount = Math.max(0, m.relativeCount + (enroll ? 1 : -1));
    }
    m.changes.push({ product: e.product, action: e.action, status: e.status, date: e.applicationDate.toISOString() });
  }

  return [...byMember.values()];
}
