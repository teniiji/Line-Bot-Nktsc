import { describe, expect, it } from "vitest";
import { countedElsewhere, describeDoubleCount } from "../lib/roundDoubleCount";
import { EXCLUDE_REASONS, IN_RESULT_REASON, OTHER_ROUND_REASON, autoSlipReasons, excludeReasonLabel } from "../lib/statementSlipHints";

const mine = (id: string, fingerprint: string, counts = true) => ({ id, fingerprint, counts });
const other = (fingerprint: string, label: string, counts = true) => ({
  fingerprint,
  label,
  counts,
});

describe("countedElsewhere", () => {
  it("finds one payment settling two months at once", () => {
    // September's export loaded into the August round to catch the late
    // payers, and into September for the current month. Every member who
    // paid once is now marked as having settled both.
    const found = countedElsewhere(
      [mine("t1", "413|2026-09-12|3000")],
      [other("413|2026-09-12|3000", "ส.ค. 2569")]
    );
    expect(found.get("t1")).toEqual(["ส.ค. 2569"]);
  });

  it("says nothing about the ordinary transfer", () => {
    // Nearly every line. A round counting a payment nobody else counts is
    // the whole point of a round.
    expect(countedElsewhere([mine("t1", "a")], [])).toEqual(new Map());
    expect(countedElsewhere([mine("t1", "a")], [other("b", "ส.ค. 2569")])).toEqual(new Map());
  });

  it("stops flagging once the line has been set aside here", () => {
    // Which is exactly the state the flag exists to produce — going on about
    // it would be telling somebody off for having fixed it.
    const found = countedElsewhere(
      [mine("t1", "f", false)],
      [other("f", "ส.ค. 2569")]
    );
    expect(found.size).toBe(0);
  });

  it("stops flagging once the other round has set it aside", () => {
    expect(
      countedElsewhere([mine("t1", "f")], [other("f", "ส.ค. 2569", false)]).size
    ).toBe(0);
  });

  it("names every round counting it, once each and in order", () => {
    // A line can reach three rounds: two exports overlapping the same days,
    // loaded across three months while chasing arrears.
    const found = countedElsewhere(
      [mine("t1", "f")],
      [
        other("f", "ก.ย. 2569"),
        other("f", "ก.ค. 2569"),
        other("f", "ก.ย. 2569"),
      ]
    );
    expect(found.get("t1")).toEqual(["ก.ค. 2569", "ก.ย. 2569"]);
  });

  it("keeps each transfer's answer to itself", () => {
    const found = countedElsewhere(
      [mine("t1", "shared"), mine("t2", "alone")],
      [other("shared", "ส.ค. 2569")]
    );
    expect(found.has("t1")).toBe(true);
    expect(found.has("t2")).toBe(false);
  });
});

describe("describeDoubleCount", () => {
  it("names the rounds, since the question cannot be answered without them", () => {
    expect(describeDoubleCount(["ส.ค. 2569"])).toContain("ส.ค. 2569");
    expect(describeDoubleCount(["ก.ค. 2569", "ก.ย. 2569"])).toContain("และ");
  });
});

describe("EXCLUDE_REASONS", () => {
  it("offers the reason a double-counted line actually needs", () => {
    // Without it the only way to set one aside was "อื่นๆ", which three
    // months later reads as nobody knowing why.
    expect(EXCLUDE_REASONS).toContain(OTHER_ROUND_REASON);
  });

  it("keeps the catch-all last, so it stays the last resort", () => {
    expect(EXCLUDE_REASONS.at(-1)).toBe("อื่นๆ");
  });

  it("never offers the deduction payment itself as a reason to exclude", () => {
    expect(EXCLUDE_REASONS).not.toContain("ชำระเก็บไม่ได้รายเดือน");
  });
});

describe("excludeReasonLabel", () => {
  it("reads the already-counted reason as such, and every other as money for something else", () => {
    expect(EXCLUDE_REASONS).toContain(IN_RESULT_REASON);
    expect(excludeReasonLabel(IN_RESULT_REASON)).toBe("✅ รวมอยู่ในผลการหักแล้ว");
    expect(excludeReasonLabel("ซื้อหุ้น")).toBe("ซื้อหุ้น");
  });
});

describe("autoSlipReasons", () => {
  const t = (id: string, amount: number, at: string) => ({
    id,
    memberNumber: "21730",
    amount,
    transferredAt: new Date(at),
  });
  const slip = (amount: number, date: string, category: string) => ({
    memberNumber: "21730",
    amount,
    date: new Date(date),
    category,
  });

  it("sets aside a transfer the member's own slip that day filed as something else", () => {
    // 21730: ฿400,000 sent as ฝากเงิน, the bank line the same afternoon.
    expect(
      autoSlipReasons([t("a", 400000, "2026-09-25T13:11:00Z")], [slip(400000, "2026-09-25T13:20:00Z", "ฝากเงิน")])
    ).toEqual(new Map([["a", "ฝากเงิน"]]));
  });

  it("leaves it as a hint when the slip is days away, or filed under a purpose the round keeps for itself", () => {
    expect(
      autoSlipReasons([t("a", 400000, "2026-09-25T13:11:00Z")], [slip(400000, "2026-09-27T13:20:00Z", "ฝากเงิน")]).size
    ).toBe(0);
    expect(
      autoSlipReasons([t("a", 400000, "2026-09-25T13:11:00Z")], [slip(400000, "2026-09-25T13:20:00Z", "อื่นๆ")]).size
    ).toBe(0);
  });

  it("never takes a slip filed as the deduction payment itself", () => {
    expect(
      autoSlipReasons(
        [t("a", 2000, "2026-09-25T13:11:00Z")],
        [slip(2000, "2026-09-25T13:20:00Z", "ชำระเก็บไม่ได้รายเดือน")]
      ).size
    ).toBe(0);
  });
});
