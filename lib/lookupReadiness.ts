// Whether the cooperative can verify anybody's identity at all.
//
// The member-number lookup asks for a national ID number and a registered
// phone, then looks for a roster row where both match (matchesIdentity, which
// refuses outright when the roster row is missing either). That is the right
// check — it is what stands between a caller and somebody else's member
// number.
//
// It is the wrong thing to ask for when no roster row carries those fields.
// Then the check cannot succeed for anyone, and a member who answers it in
// good faith gets told their details "do not match the cooperative's
// records": a sentence that describes them as mistaken when what actually
// happened is that the cooperative had nothing to compare against. One member
// typed her national ID number into a chat window to fail a test that had no
// pass.
//
// So it is asked once of the roster, not of the member: can this check
// succeed for anybody? If not, nothing is collected and nobody is blamed.
//
// The roster import reads a national ID column when the file has one, and the
// หักไม่ได้ sheet's own ID column is deliberately never read, so a cooperative
// that has only ever imported round lists has none of this on file.

export interface VerifiableRow {
  nationalId: string | null;
  phone: string | null;
}

/**
 * True when at least one roster row carries both fields the check compares.
 * One is enough: the flow is then answerable in principle, and a failure
 * genuinely means "this did not match".
 */
export function rosterCanVerify(rows: VerifiableRow[]): boolean {
  return rows.some((row) => Boolean(row.nationalId?.trim()) && Boolean(row.phone?.trim()));
}
