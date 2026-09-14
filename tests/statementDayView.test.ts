import { describe, expect, it } from "vitest";
import { STATUS_LABELS, statementLineStatus, type StatementLineStatus } from "../lib/statementDayView";

describe("statementLineStatus", () => {
  it("calls a paired line matched", () => {
    expect(
      statementLineStatus({ isMemberDeposit: true, matched: true, ownerMemberNumber: "29262" })
    ).toBe("matched");
  });

  it("separates money whose payer is known from money whose payer is not", () => {
    // The two halves of "money with no slip", which need different work: one
    // is a member who simply did not tell the bot, the other is the list
    // staff have to chase.
    expect(
      statementLineStatus({ isMemberDeposit: true, matched: false, ownerMemberNumber: "29262" })
    ).toBe("knownPayer");
    expect(
      statementLineStatus({ isMemberDeposit: true, matched: false, ownerMemberNumber: null })
    ).toBe("unknownPayer");
  });

  it("keeps the bank's own postings out of the member buckets", () => {
    // Fees and outward transfers are on the statement but are not a member
    // paying in, so they can be neither matched nor owed by anyone.
    expect(
      statementLineStatus({ isMemberDeposit: false, matched: false, ownerMemberNumber: null })
    ).toBe("notMemberMoney");
  });

  it("does not let a stale owner or match override that", () => {
    // Checked before everything else on purpose: a line the reconciliation
    // never considers must not be reported as a member's payment because some
    // other field happened to be set.
    expect(
      statementLineStatus({ isMemberDeposit: false, matched: true, ownerMemberNumber: "29262" })
    ).toBe("notMemberMoney");
  });

  it("gives every status a label, so no row can render blank", () => {
    const all: StatementLineStatus[] = [
      "matched",
      "knownPayer",
      "unknownPayer",
      "notMemberMoney",
    ];
    for (const status of all) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("puts every line in exactly one status", () => {
    // The property the view rests on: the count shown at the top is the count
    // of lines in the file, so "did it drop something?" is answerable. If a
    // line could fall through, the count would silently disagree with the
    // bank's own paper.
    const cases = [
      { isMemberDeposit: true, matched: true, ownerMemberNumber: "1" },
      { isMemberDeposit: true, matched: true, ownerMemberNumber: null },
      { isMemberDeposit: true, matched: false, ownerMemberNumber: "1" },
      { isMemberDeposit: true, matched: false, ownerMemberNumber: null },
      { isMemberDeposit: false, matched: false, ownerMemberNumber: null },
    ];
    for (const line of cases) {
      expect(STATUS_LABELS[statementLineStatus(line)]).toBeTruthy();
    }
  });
});
