import { describe, expect, it } from "vitest";
import { splitSharesOutside, type SplitShare } from "../lib/splitSharesOutside";

// 23321: ฿7,400 of a เขต transfer divided on the daily page, placed nowhere.
const share = (over: Partial<SplitShare> = {}): SplitShare => ({
  splitId: "s1",
  lineId: "l1",
  lineFingerprint: "447|9802889202|52000.00|2026-09-20|1|0",
  memberNumber: "023321",
  roundMemberNumber: "23321",
  amount: 7400,
  postedAt: new Date("2026-09-20T10:00:00Z"),
  createdAt: new Date("2026-09-20T11:00:00Z"),
  payerName: "สพป.บึงกาฬ",
  lineAmount: 52000,
  ...over,
});

const labels: Record<string, string> = { aug: "ส.ค. 2569", sep: "ก.ย. 2569" };

describe("splitSharesOutside", () => {
  it("lists a share no round holds, for the round's own member, with nothing free for a debt", () => {
    const [row] = splitSharesOutside([share()], [], "aug", (id) => labels[id]);
    expect(row).toMatchObject({
      memberNumber: "23321",
      amount: 7400,
      countedIn: null,
      available: 0,
      otherPeriod: "0969",
      splitShare: { payerName: "สพป.บึงกาฬ", lineAmount: 52000, memberNumber: "023321" },
    });
  });

  it("leaves out a share this round already holds, whatever spelling the division used", () => {
    // splitFingerprint keys on the member number without its leading zeros.
    const placed = [{ fingerprint: "line:447|9802889202|52000.00|2026-09-20|1|0#23321", roundId: "aug" }];
    expect(splitSharesOutside([share()], placed, "aug", (id) => labels[id])).toEqual([]);
  });

  it("names the other round that holds it", () => {
    const placed = [{ fingerprint: "line:447|9802889202|52000.00|2026-09-20|1|0#23321", roundId: "sep" }];
    const [row] = splitSharesOutside([share()], placed, "aug", (id) => labels[id]);
    expect(row.countedIn).toBe("ก.ย. 2569");
  });
});
