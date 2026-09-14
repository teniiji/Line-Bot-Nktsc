import { describe, expect, it } from "vitest";
import { planLineMerge, postedRange, type StoredLine } from "../lib/statementLineMerge";

const line = (over: Partial<StoredLine> = {}) => ({
  fingerprint: "413|2026-09-10T08:19:54.000Z|NBSDT|10000.00|36761605.60|0",
  branch: "หนองคาย",
  description: "TR fr 4883387836",
  senderAccount: "4883387836",
  channel: "transfer",
  ...over,
});

const stored = (id: string, over: Partial<StoredLine> = {}): StoredLine => ({
  id,
  ...line(over),
});

describe("planLineMerge", () => {
  it("keeps the row a line already has instead of writing it again", () => {
    // The whole point. The id is what a staff-recorded transaction points at,
    // so a re-uploaded statement must not hand the same line a new one.
    const plan = planLineMerge([stored("line-1")], [line()]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it("writes a line the account has never held", () => {
    const fresh = line({ fingerprint: "413|...|0", description: "TR fr 4131579286" });
    const plan = planLineMerge([stored("line-1")], [line(), fresh]);
    expect(plan.create).toEqual([fresh]);
    expect(plan.unchangedCount).toBe(1);
  });

  it("refreshes a line the file now reads differently, on its own row", () => {
    // What the old delete-and-rewrite was for: a parser that has learned to
    // read the payer account still has to be able to fill it in.
    const [update] = planLineMerge(
      [stored("line-1", { senderAccount: null })],
      [line({ senderAccount: "4883387836" })]
    ).update;
    expect(update.id).toBe("line-1");
    expect(update.line.senderAccount).toBe("4883387836");
  });

  it("notices each field a re-read can change", () => {
    for (const change of [
      { branch: "บึงกาฬ" },
      { description: "TR fr 4883387836 Future Amount: 1500" },
      { senderAccount: null },
      { channel: "counter" },
    ]) {
      expect(planLineMerge([stored("line-1")], [line(change)]).update, JSON.stringify(change))
        .toHaveLength(1);
    }
  });

  it("does not take back a channel a person set by hand", () => {
    // The file will go on calling NMPSDP "other" every time it is uploaded,
    // and the month's exports overlap. Without this, re-uploading the wider
    // range silently undoes every mark staff made — and leaves the payments
    // filed against those lines sitting on money the day no longer counts.
    const plan = planLineMerge(
      [stored("line-1", { channel: "staff" })],
      [line({ channel: "other" })]
    );
    expect(plan.update).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it("still takes the file's other fields on a line a person marked", () => {
    // The mark is about what kind of money it is. Everything else on the line
    // is still the bank's to state.
    const [update] = planLineMerge(
      [stored("line-1", { channel: "staff", description: "010753700088205" })],
      [line({ channel: "other", description: "010753700088205-BU0994005S00999915K" })]
    ).update;
    expect(update.line.description).toBe("010753700088205-BU0994005S00999915K");
    expect(update.line.channel).toBe("staff");
  });

  it("lets the file classify a line nobody has marked", () => {
    // The protection is for a staff mark only — a code added to the classifier
    // must still reach the lines already stored under "other".
    const [update] = planLineMerge(
      [stored("line-1", { channel: "other" })],
      [line({ channel: "qr" })]
    ).update;
    expect(update.line.channel).toBe("qr");
  });

  it("counts the file's lines whether or not any of them were written", () => {
    // "159 lines" is what staff check the upload against, and it must not
    // depend on how much of the file was new.
    const b = line({ fingerprint: "b" });
    const c = line({ fingerprint: "c" });
    const plan = planLineMerge([stored("line-1"), stored("line-b", { fingerprint: "b" })], [
      line(),
      b,
      c,
    ]);
    expect(plan.create.length + plan.update.length + plan.unchangedCount).toBe(3);
  });

  it("plans one write for a line the file lists twice", () => {
    // Two creates on one fingerprint would break the unique index mid
    // transaction and lose the whole upload.
    const plan = planLineMerge([], [line(), line()]);
    expect(plan.create).toHaveLength(1);
  });

  it("leaves lines the file does not mention alone", () => {
    // An export covering half a month must not disturb the other half.
    const plan = planLineMerge([stored("line-1"), stored("line-2", { fingerprint: "other" })], [
      line(),
    ]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });
});

describe("postedRange", () => {
  it("reads the span off the file, not out of the database", () => {
    const range = postedRange([
      { postedAt: new Date("2026-09-10T08:19:54.000Z") },
      { postedAt: new Date("2026-09-08T09:02:39.000Z") },
      { postedAt: new Date("2026-09-11T15:40:00.000Z") },
    ]);
    expect(range.from?.toISOString()).toBe("2026-09-08T09:02:39.000Z");
    expect(range.to?.toISOString()).toBe("2026-09-11T15:40:00.000Z");
  });

  it("says nothing about an empty file", () => {
    expect(postedRange([])).toEqual({ from: null, to: null });
  });

  it("ignores a line with no date rather than reading it as now", () => {
    const range = postedRange([
      { postedAt: null },
      { postedAt: new Date("2026-09-10T08:19:54.000Z") },
    ]);
    expect(range.from?.toISOString()).toBe("2026-09-10T08:19:54.000Z");
    expect(range.to?.toISOString()).toBe("2026-09-10T08:19:54.000Z");
  });
});
