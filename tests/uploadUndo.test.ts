import { describe, expect, it } from "vitest";
import { planUndo, readChanges, recordedChanges } from "../lib/uploadUndo";

const roster = [
  { memberNumber: "2260", deductionResult: "awaiting", amountDue: 0, expectedAmount: 500 },
  { memberNumber: "6223", deductionResult: "awaiting", amountDue: 0, expectedAmount: 1100 },
  { memberNumber: "6939", deductionResult: "uncollected", amountDue: 5420, expectedAmount: 5000 },
];

describe("what a results upload changed", () => {
  it("keeps who moved and from what, and who it added", () => {
    const changes = recordedChanges(roster, {
      update: [
        { memberNumber: "2260", result: "uncollected", amountDue: 1340 },
        // Already so — nothing to undo.
        { memberNumber: "6939", result: "uncollected", amountDue: 5420 },
      ],
      create: [{ memberNumber: "99999", result: "uncollected", amountDue: 800 }],
    });
    expect(changes).toEqual([
      {
        memberNumber: "2260",
        before: { deductionResult: "awaiting", amountDue: 0, expectedAmount: 500 },
        after: { deductionResult: "uncollected", amountDue: 1340 },
      },
      { memberNumber: "99999", before: null, after: { deductionResult: "uncollected", amountDue: 800 } },
    ]);
  });
});

describe("taking it back", () => {
  const changes = recordedChanges(roster, {
    update: [
      { memberNumber: "2260", result: "uncollected", amountDue: 1340 },
      { memberNumber: "6223", result: "uncollected", amountDue: 1940 },
    ],
    create: [
      { memberNumber: "99999", result: "uncollected", amountDue: 800 },
      { memberNumber: "88888", result: "uncollected", amountDue: 600 },
    ],
  });

  it("restores what the file still holds, and leaves newer work alone", () => {
    const plan = planUndo(
      changes,
      new Map([
        ["2260", { deductionResult: "uncollected", amountDue: 1340, amountPaid: 1340, transfers: 1 }],
        // A later file said หักได้.
        ["6223", { deductionResult: "collected", amountDue: 0, amountPaid: 0, transfers: 0 }],
        ["99999", { deductionResult: "uncollected", amountDue: 800, amountPaid: 0, transfers: 0 }],
        ["88888", { deductionResult: "uncollected", amountDue: 600, amountPaid: 600, transfers: 1 }],
      ])
    );
    expect(plan.restore).toEqual([
      { memberNumber: "2260", before: { deductionResult: "awaiting", amountDue: 0, expectedAmount: 500 } },
    ]);
    expect(plan.remove).toEqual(["99999"]);
    expect(plan.skipped.map((s) => s.memberNumber)).toEqual(["6223", "88888"]);
  });

  it("skips a member no longer on the round", () => {
    expect(planUndo(changes.slice(0, 1), new Map()).skipped[0].reason).toBe("ไม่อยู่ในรอบแล้ว");
  });
});

describe("stored changes", () => {
  it("reads an upload recorded before changes were kept as not undoable", () => {
    expect(readChanges(null)).toBeNull();
    expect(readChanges([{ memberNumber: "1", after: { deductionResult: "uncollected", amountDue: 1 }, before: null }])).toHaveLength(1);
  });
});
