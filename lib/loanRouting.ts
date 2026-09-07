import { lineTargetKind } from "./lineGroups";

// Pure precedence logic for deciding who a loan (สินเชื่อ) service request
// forwards to, extracted from resolveForwardTarget in financeAgent.ts so
// it's unit-testable without a database. The caller resolves each layer
// (responsible-code contact, unit-name contact, env fallback) separately
// and this function just picks the highest-priority one that's set.
//
// Precedence, highest first:
//   1. responsibleContactLineUserId — per-member "รหัสผู้รับผิดชอบ" code
//      match (ResponsibleContact). Most reliable: a short code copied
//      exactly from the source spreadsheet, not typed free text.
//   2. unitContactLineUserId — legacy unit-name text match
//      (LoanDistrictContact). Kept for members whose responsibleCode isn't
//      set but whose unitName is.
//   3. envFallback — LINE_FORWARD_LOAN_ID. Always the last resort so a
//      loan request is never silently dropped just because a member's
//      routing data is incomplete.
//
// Every layer must be a personal LINE id. Unlike รายการหัก and the other
// departments, a loan enquiry may never go to a group: it names the member
// and their case, and the whole point of the precedence above is to reach
// the one officer who owns it. Both entry points now refuse a group id, but
// rows saved before that check existed — and LINE_FORWARD_LOAN_ID, which no
// screen validates — can still hold one, so a bad layer is skipped here and
// the next one is tried. If none survives, the caller logs the request as
// "unconfigured" and tells the member to phone the office: visibly not
// forwarded, which is recoverable, rather than forwarded to a room of people
// who should not have seen it.
const personalOnly = (id: string | null): string | null => {
  if (!id) return null;
  if (lineTargetKind(id.trim()) === "user") return id.trim();
  console.warn(
    `[loanRouting] refusing a loan forward target that is not a personal LINE id: ${id.slice(0, 1)}… — สินเชื่อต้องส่งรายบุคคลเท่านั้น`
  );
  return null;
};

export function pickLoanForwardTarget(input: {
  responsibleContactLineUserId: string | null;
  unitContactLineUserId: string | null;
  envFallback: string | null;
}): string | null {
  return (
    personalOnly(input.responsibleContactLineUserId) ??
    personalOnly(input.unitContactLineUserId) ??
    personalOnly(input.envFallback)
  );
}
