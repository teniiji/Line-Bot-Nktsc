import { describe, expect, it } from "vitest";
import { reconcileFile, type FileMember, type RegisterEvent } from "../lib/coverageReconcile";

const m = (n: string, over: Partial<FileMember> = {}): FileMember => ({
  memberNumber: n,
  memberName: `สมาชิก ${n}`,
  unitName: "หน่วย",
  insuredSum: 0,
  hasSok: false,
  hasScs: false,
  hasSst: false,
  hasSsk: false,
  relativeCount: 0,
  ...over,
});

const ev = (n: string, product: string, action: string, date: string, status = "approved"): RegisterEvent => ({
  memberNumber: n,
  memberName: null,
  unitName: null,
  product,
  action,
  status,
  applicationDate: new Date(`${date}T00:00:00Z`),
});

const window = { from: new Date("2026-04-01T00:00:00Z"), to: new Date("2027-03-31T00:00:00Z") };

describe("reconcileFile", () => {
  it("lists applications the file lacks and cancellations it still holds", () => {
    const items = reconcileFile(
      [m("1", { hasSok: true }), m("3", { insuredSum: 500000 }), m("4", { hasSst: true })],
      null,
      [
        ev("1", "sok", "enroll", "2026-06-01"), // in the file: fine
        ev("2", "scs", "enroll", "2026-07-01"), // not in the file
        ev("3", "life", "cancel", "2026-08-01"), // still in the file
        ev("4", "sst", "enroll", "2027-05-01"), // after the file: not counted
        ev("5", "ssk", "enroll", "2026-09-01", "rejected"), // rejected: not counted
        ev("6", "sok", "enroll", "2026-06-01"),
        ev("6", "sok", "cancel", "2026-10-01"), // enrolled then cancelled: net nothing to find
      ],
      window
    );
    expect(items.map((i) => [i.kind, i.memberNumber, i.product])).toEqual([
      ["missingFromFile", "2", "scs"],
      ["stillInFile", "3", "life"],
    ]);
    expect(items[0].memberName).toBeNull();
    expect(items[1].memberName).toBe("สมาชิก 3");
  });

  it("against the previous file, finds cover added or dropped with nothing in the register", () => {
    const items = reconcileFile(
      [m("1", { hasSok: true, hasScs: true }), m("2"), m("3", { relativeCount: 3 })],
      [m("1", { hasSok: true }), m("2", { hasSst: true }), m("3", { relativeCount: 1 })],
      [ev("3", "relative", "enroll", "2026-05-01")],
      window
    );
    expect(items.map((i) => [i.kind, i.memberNumber, i.product, i.count])).toEqual([
      ["addedWithoutRecord", "1", "scs", undefined],
      ["addedWithoutRecord", "3", "relative", 1],
      ["removedWithoutRecord", "2", "sst", undefined],
    ]);
  });

  it("counts relatives against the previous file's count", () => {
    const items = reconcileFile(
      [m("1", { relativeCount: 1 }), m("2", { relativeCount: 2 })],
      [m("1", { relativeCount: 1 }), m("2", { relativeCount: 2 })],
      [ev("1", "relative", "enroll", "2026-05-01"), ev("1", "relative", "enroll", "2026-05-02"), ev("2", "relative", "cancel", "2026-05-03")],
      window
    );
    expect(items.map((i) => [i.kind, i.memberNumber, i.count])).toEqual([
      ["missingFromFile", "1", 2],
      ["stillInFile", "2", 1],
    ]);
  });
});
