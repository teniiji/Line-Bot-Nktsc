// Precedence for non-loan department routing, kept pure/unit-testable the
// same way lib/loanRouting.ts is: a department with officers assigned in
// DepartmentContact gets all of them (broadcast, so no request is missed
// regardless of who's on duty); an empty department falls back to the
// single LINE_FORWARD_GENERAL_ID so a not-yet-staffed department still
// reaches someone instead of silently dropping the request.
export function pickDepartmentForwardTargets(input: {
  contactLineUserIds: string[];
  envFallback: string | null;
}): string[] {
  if (input.contactLineUserIds.length > 0) {
    return input.contactLineUserIds;
  }
  return input.envFallback ? [input.envFallback] : [];
}
