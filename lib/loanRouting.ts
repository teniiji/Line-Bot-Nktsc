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
export function pickLoanForwardTarget(input: {
  responsibleContactLineUserId: string | null;
  unitContactLineUserId: string | null;
  envFallback: string | null;
}): string | null {
  return (
    input.responsibleContactLineUserId ??
    input.unitContactLineUserId ??
    input.envFallback
  );
}
