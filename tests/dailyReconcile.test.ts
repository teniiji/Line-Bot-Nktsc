import { describe, expect, it } from "vitest";
import { DepositLine, SlipRecord, reconcileDay } from "../lib/dailyReconcile";

const deposit = (over: Partial<DepositLine> = {}): DepositLine => ({
  id: "d1",
  amount: 5000,
  postedAt: new Date("2026-08-31T14:32:07.000Z"),
  senderAccount: "4131572885",
  channel: "transfer",
  branch: "หนองคาย",
  description: "TR fr 4131572885",
  ...over,
});

const slip = (over: Partial<SlipRecord> = {}): SlipRecord => ({
  id: "s1",
  amount: 5000,
  date: new Date("2026-08-31T00:00:00.000Z"),
  memberNumber: "30051",
  memberFullName: "นางสาวสายธาร กะมะเริ",
  category: "ชำระเก็บไม่ได้รายเดือน",
  // Default to a slip that shows neither — that is every transaction logged
  // before these were read, so it is the case that has to keep working.
  transferTime: null,
  senderAccount: null,
  // Set only on the transactions staff recorded from a bank line themselves.
  statementLineId: null,
  ...over,
});

const directory = new Map([["4131572885", "30051"]]);

describe("reconcileDay, member numbers written differently", () => {
  // 8 Sep 2026, นางสาวภรณ์ทิพย์ เข็มศิริ. The money was in the statement and
  // the slip was in the system; they refused to pair because the two records
  // spelled her member number differently.
  const HER_ACCOUNT = "9825072199";
  const herDeposit = deposit({
    id: "line-4200",
    amount: 4200,
    postedAt: new Date("2026-09-08T12:30:24.000Z"),
    senderAccount: HER_ACCOUNT,
    description: `TR fr ${HER_ACCOUNT}`,
  });
  const herSlip = slip({
    amount: 4200,
    date: new Date("2026-09-08T00:00:00.000Z"),
    // As the slip was filed: with a leading zero.
    memberNumber: "029262",
    memberFullName: "นางสาวภรณ์ทิพย์ เข็มศิริ",
    transferTime: "12:30",
    senderAccount: "XXX-X-XX219-9",
  });
  // As the หักไม่ได้ sheet has it: without.
  const sheet = new Map([[HER_ACCOUNT, "29262"]]);

  it("pairs them, on the directory's own evidence", () => {
    const result = reconcileDay([herDeposit], [herSlip], sheet);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("account");
    expect(result.slipsWithoutMoney).toHaveLength(0);
    expect(result.depositsWithoutSlip).toHaveLength(0);
  });

  it("still refuses a deposit that belongs to a genuinely different member", () => {
    // The refusal is the point of the check and must survive the fix: money
    // from somebody else's account is not this member's payment however well
    // the amount fits.
    const result = reconcileDay(
      [herDeposit],
      [herSlip],
      new Map([[HER_ACCOUNT, "29252"]])
    );
    expect(result.matched).toHaveLength(0);
    expect(result.slipsWithoutMoney).toHaveLength(1);
  });

  it("does not treat an unknown owner as agreement", () => {
    // With nothing in the directory the pair still has to be earned — here by
    // the account printed on the slip, not by the member number.
    const result = reconcileDay([herDeposit], [herSlip], new Map());
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("slipAccount");
  });

  it("does not refuse a slip that names no member at all", () => {
    const result = reconcileDay(
      [herDeposit],
      [slip({ amount: 4200, memberNumber: null, senderAccount: null, transferTime: null })],
      sheet
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("amount");
  });
});

describe("reconcileDay, staff-recorded transactions", () => {
  // Recording an unclaimed deposit from the daily view writes the line's id
  // onto the transaction, so this pairing is the one thing here that is not
  // an inference. It has to beat every guess, and it has to stay put.

  it("pairs a recorded transaction with its own line and says who decided", () => {
    const result = reconcileDay(
      [deposit({ id: "line-a" })],
      [slip({ statementLineId: "line-a" })],
      new Map()
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("staff");
    expect(result.depositsWithoutSlip).toHaveLength(0);
  });

  it("never lets a recorded transaction drift onto a different line", () => {
    // Two ฿40,000 transfers at 09:26 from one account — the real pair from
    // 8 Sep. Staff recorded the first; the second must stay unclaimed rather
    // than absorb the record for the first.
    const result = reconcileDay(
      [deposit({ id: "line-a", amount: 40000 }), deposit({ id: "line-b", amount: 40000 })],
      [slip({ amount: 40000, statementLineId: "line-a" })],
      new Map()
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].deposit.id).toBe("line-a");
    expect(result.depositsWithoutSlip.map((d) => d.id)).toEqual(["line-b"]);
  });

  it("leaves the record unpaired when its line is not in this day", () => {
    // Rather than falling back to matching by amount: the person said which
    // line this was, and the honest answer to "that line is not here" is to
    // show it as unmatched, not to pick another one.
    const result = reconcileDay(
      [deposit({ id: "line-b" })],
      [slip({ statementLineId: "line-a" })],
      directory
    );
    expect(result.matched).toHaveLength(0);
    expect(result.slipsWithoutMoney).toHaveLength(1);
    expect(result.depositsWithoutSlip).toHaveLength(1);
  });

  it("outranks a slip that fits the same line on amount alone", () => {
    // The staff record claims its line first, and the guess falls through to
    // whatever is left — which is what stops one payment being counted twice.
    const result = reconcileDay(
      [deposit({ id: "line-a" })],
      [slip({ id: "s-guess" }), slip({ id: "s-recorded", statementLineId: "line-a" })],
      new Map()
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].slip.id).toBe("s-recorded");
    expect(result.slipsWithoutMoney.map((s) => s.id)).toEqual(["s-guess"]);
  });

  it("still counts the money once in the totals", () => {
    const result = reconcileDay(
      [deposit({ id: "line-a", amount: 29054 })],
      [slip({ amount: 29054, statementLineId: "line-a" })],
      new Map()
    );
    expect(result.totals.matchedAmount).toBe(29054);
    expect(result.totals.depositAmount).toBe(29054);
  });
});

describe("reconcileDay", () => {
  it("pairs a slip with its money when the directory knows the account", () => {
    const result = reconcileDay([deposit()], [slip()], directory);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("account");
    expect(result.slipsWithoutMoney).toHaveLength(0);
    expect(result.depositsWithoutSlip).toHaveLength(0);
  });

  it("still pairs on the amount when the account is unknown", () => {
    // A counter deposit gives a reference, not the member's own account, so
    // most of these can only ever be matched by amount.
    const result = reconcileDay(
      [deposit({ senderAccount: null, channel: "counter" })],
      [slip()],
      directory
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].basis).toBe("amount");
  });

  it("flags a slip with no money behind it", () => {
    const result = reconcileDay([], [slip()], directory);
    expect(result.slipsWithoutMoney.map((s) => s.id)).toEqual(["s1"]);
    expect(result.matched).toHaveLength(0);
  });

  it("flags money nobody sent a slip for", () => {
    const result = reconcileDay([deposit()], [], directory);
    expect(result.depositsWithoutSlip.map((d) => d.id)).toEqual(["d1"]);
  });

  it("does not pair amounts that merely look close", () => {
    const result = reconcileDay([deposit({ amount: 5001 })], [slip()], directory);
    expect(result.matched).toHaveLength(0);
    expect(result.slipsWithoutMoney).toHaveLength(1);
    expect(result.depositsWithoutSlip).toHaveLength(1);
  });

  it("refuses to pair money whose account belongs to someone else", () => {
    // The amount fits, but the directory says this account is 30051's and the
    // slip is 40404's. Reporting both sides as unexplained is the honest
    // answer; a confident wrong pairing would hide the very thing the view
    // exists to surface.
    const result = reconcileDay([deposit()], [slip({ memberNumber: "40404" })], directory);
    expect(result.matched).toHaveLength(0);
    expect(result.slipsWithoutMoney).toHaveLength(1);
    expect(result.depositsWithoutSlip).toHaveLength(1);
  });

  it("prefers the pairing the directory confirms over a bare amount match", () => {
    // Two members, two identical amounts. The one whose account is known must
    // pair with its own slip rather than being taken by the other.
    const known = deposit({ id: "known", senderAccount: "4131572885" });
    const anonymous = deposit({ id: "anon", senderAccount: null, channel: "counter" });
    const mine = slip({ id: "mine", memberNumber: "30051" });
    const theirs = slip({ id: "theirs", memberNumber: "99999" });

    const result = reconcileDay([anonymous, known], [theirs, mine], directory);

    expect(result.matched).toHaveLength(2);
    const byAccount = result.matched.find((m) => m.basis === "account");
    expect(byAccount?.deposit.id).toBe("known");
    expect(byAccount?.slip.id).toBe("mine");
  });

  it("uses each slip and each payment once", () => {
    const result = reconcileDay(
      [deposit({ id: "d1" }), deposit({ id: "d2", senderAccount: null })],
      [slip({ id: "s1" })],
      directory
    );
    expect(result.matched).toHaveLength(1);
    expect(result.depositsWithoutSlip).toHaveLength(1);
  });

  it("still pairs a slip the bank posted the next morning, and says so", () => {
    const result = reconcileDay(
      [deposit({ postedAt: new Date("2026-09-01T08:10:00.000Z") })],
      [slip({ date: new Date("2026-08-31T00:00:00.000Z") })],
      directory
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].dayApart).toBe(true);
  });

  it("prefers a same-day pairing over one a day apart", () => {
    const sameDay = deposit({ id: "same", senderAccount: null });
    const nextDay = deposit({
      id: "next",
      senderAccount: null,
      postedAt: new Date("2026-09-01T08:10:00.000Z"),
    });
    const result = reconcileDay([nextDay, sameDay], [slip()], directory);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].deposit.id).toBe("same");
  });

  it("totals both sides so the day's gap is visible at a glance", () => {
    const result = reconcileDay(
      [deposit({ id: "d1", amount: 5000 }), deposit({ id: "d2", amount: 1200, senderAccount: null })],
      [slip({ id: "s1", amount: 5000 }), slip({ id: "s2", amount: 900, memberNumber: "77777" })],
      directory
    );
    expect(result.totals).toMatchObject({
      depositCount: 2,
      depositAmount: 6200,
      slipCount: 2,
      slipAmount: 5900,
      matchedCount: 1,
      matchedAmount: 5000,
    });
  });

  it("handles a payment the bank gave no date for", () => {
    const result = reconcileDay([deposit({ postedAt: null })], [slip()], directory);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].dayApart).toBe(false);
  });

  describe("what the slip itself says", () => {
    // The directory only holds the members staff have bound by hand, so on
    // most days it says nothing. These are the cases it cannot reach.
    const noDirectory = new Map<string, string>();

    it("pairs on the slip's own account without any directory at all", () => {
      const result = reconcileDay(
        [deposit()],
        [slip({ senderAccount: "xxx-x-x7288-5" })],
        noDirectory
      );
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].basis).toBe("slipAccount");
    });

    it("refuses a pair the slip's own account contradicts", () => {
      // Same amount, same day, but the member's slip says the money left an
      // account whose visible digits are not the one the bank named. Two
      // unexplained rows is the honest answer.
      const result = reconcileDay(
        [deposit()],
        [slip({ senderAccount: "xxx-x-x1234-5" })],
        noDirectory
      );
      expect(result.matched).toHaveLength(0);
      expect(result.slipsWithoutMoney).toHaveLength(1);
      expect(result.depositsWithoutSlip).toHaveLength(1);
    });

    it("tells apart two identical amounts by the clock on the slip", () => {
      // The day this was built for: two members each transfer ฿5,000 and
      // neither account is in the directory. Without the time it is a coin
      // flip; with it each slip finds its own payment.
      const morning = deposit({
        id: "morning",
        senderAccount: null,
        postedAt: new Date("2026-08-31T09:07:46.000Z"),
      });
      const afternoon = deposit({
        id: "afternoon",
        senderAccount: null,
        postedAt: new Date("2026-08-31T14:32:07.000Z"),
      });
      const early = slip({ id: "early", transferTime: "09:05", memberNumber: "11111" });
      const late = slip({ id: "late", transferTime: "14:30", memberNumber: "22222" });

      const result = reconcileDay([afternoon, morning], [late, early], noDirectory);

      expect(result.matched).toHaveLength(2);
      const pairs = Object.fromEntries(result.matched.map((m) => [m.slip.id, m.deposit.id]));
      expect(pairs).toEqual({ early: "morning", late: "afternoon" });
      expect(result.matched.every((m) => m.basis === "time")).toBe(true);
    });

    it("reports how far apart the two clocks were", () => {
      const result = reconcileDay(
        [deposit({ postedAt: new Date("2026-08-31T14:32:00.000Z") })],
        [slip({ transferTime: "14:30" })],
        directory
      );
      expect(result.matched[0].minutesApart).toBe(2);
    });

    it("counts the clock across a midnight the bank posted after", () => {
      // Sent at 23:55, posted 08:10 the next morning: eight hours apart, not
      // the fifteen hours a bare clock subtraction would give.
      const result = reconcileDay(
        [deposit({ postedAt: new Date("2026-09-01T08:10:00.000Z") })],
        [slip({ date: new Date("2026-08-31T00:00:00.000Z"), transferTime: "23:55" })],
        directory
      );
      expect(result.matched[0].minutesApart).toBe(495);
    });

    it("does not call a whole day apart a match on time", () => {
      const result = reconcileDay(
        [deposit({ senderAccount: null, postedAt: new Date("2026-08-31T14:32:00.000Z") })],
        [slip({ transferTime: "07:00" })],
        noDirectory
      );
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].basis).toBe("amount");
    });

    it("keeps the directory's word above the slip's own", () => {
      // A member can mistype nothing here — the slip is read by a model, the
      // directory is a binding staff made deliberately.
      const result = reconcileDay(
        [deposit()],
        [slip({ senderAccount: "xxx-x-x7288-5", transferTime: "14:30" })],
        directory
      );
      expect(result.matched[0].basis).toBe("account");
    });

    it("leaves a slip with neither exactly as it was", () => {
      // Everything logged before this existed carries no time and no account,
      // and must keep matching on the amount exactly as it always did.
      const result = reconcileDay(
        [deposit({ senderAccount: null })],
        [slip()],
        noDirectory
      );
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].basis).toBe("amount");
      expect(result.matched[0].minutesApart).toBeNull();
    });
  });
});
