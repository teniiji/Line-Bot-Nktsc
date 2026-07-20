// Single source of truth for department names, shared by the Claude tool
// schema (lib/financeAgent.ts), its input validation, and the dashboard's
// department-contact manager UI — keeps all three from drifting apart.
// "สินเชื่อ" routes per-member via ResponsibleContact/LoanDistrictContact
// (lib/financeAgent.ts's resolveForwardTargets); every other named
// department routes via DepartmentContact (broadcast to all officers
// assigned there). "อื่นๆ" is the catch-all for anything that doesn't fit.
export const DEPARTMENTS = [
  "สินเชื่อ",
  "เงินฝาก",
  "สารสนเทศ",
  "สวัสดิการ",
  "นิติการ",
  "บัญชี",
  "ฌาปนกิจ",
  "บริหารสำนักงาน/ธุรการ",
  "อื่นๆ",
] as const;

export type Department = (typeof DEPARTMENTS)[number];
