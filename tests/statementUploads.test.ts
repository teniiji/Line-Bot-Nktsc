import { describe, expect, it } from "vitest";
import {
  overlapsAnotherAccount,
  removalProblem,
  type StatementUpload,
} from "../lib/statementUploads";

const upload = (over: Partial<StatementUpload> = {}): StatementUpload => ({
  account: "413",
  branch: "หนองคาย",
  sourceFile: "413Statement_0369.xlsx",
  lines: 1186,
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:00.000Z",
  amount: 8579272.06,
  ...over,
});

describe("removalProblem", () => {
  it("lets an upload nobody has recorded from be removed", () => {
    expect(removalProblem(0)).toBeNull();
  });

  it("refuses while a payment is filed against one of its lines", () => {
    // Deleting the line leaves the transaction pointing at nothing: the
    // payment stops appearing against the money it paid, and nothing says so.
    const problem = removalProblem(3);
    expect(problem).toContain("3");
    expect(problem).toContain("รายการ");
  });
});

describe("overlapsAnotherAccount", () => {
  it("spots the same statement filed under both accounts", () => {
    // The shape a wrong-account upload leaves: the same days, the same number
    // of lines, two accounts.
    const mine = upload();
    const twin = upload({ account: "447", branch: "บึงกาฬ", sourceFile: "สำเนา.xlsx" });
    expect(overlapsAnotherAccount(mine, [mine, twin])).toBe(true);
    expect(overlapsAnotherAccount(twin, [mine, twin])).toBe(true);
  });

  it("leaves two accounts' own statements alone", () => {
    // Both accounts are exported for the same month every month. That is
    // normal, and the line counts are not equal.
    const a = upload();
    const b = upload({ account: "447", branch: "บึงกาฬ", lines: 133 });
    expect(overlapsAnotherAccount(a, [a, b])).toBe(false);
  });

  it("does not flag an upload against itself or its own account", () => {
    const a = upload();
    const b = upload({ sourceFile: "อีกไฟล์.xlsx" });
    expect(overlapsAnotherAccount(a, [a, b])).toBe(false);
  });

  it("needs the days to actually meet", () => {
    const a = upload();
    const b = upload({
      account: "447",
      branch: "บึงกาฬ",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-30T00:00:00.000Z",
    });
    expect(overlapsAnotherAccount(a, [a, b])).toBe(false);
  });

  it("says nothing about an upload with no dates to compare", () => {
    const a = upload({ from: null, to: null });
    expect(overlapsAnotherAccount(a, [a, upload({ account: "447" })])).toBe(false);
  });
});
