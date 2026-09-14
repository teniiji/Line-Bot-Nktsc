import { describe, expect, it } from "vitest";
import {
  ALREADY_LOGGED_INSTRUCTION,
  REPEAT_WINDOW_MS,
  isRepeatOfLogged,
  type LoggedTransaction,
} from "../lib/repeatReport";

const NOW = new Date("2026-09-09T05:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 1000);

const logged = (over: Partial<LoggedTransaction> = {}): LoggedTransaction => ({
  amount: 30000,
  category: "ชำระหนี้",
  createdAt: minutesAgo(1),
  ...over,
});

describe("isRepeatOfLogged", () => {
  it("catches the message right after a confirmation", () => {
    // The reported sequence: "บันทึกแล้ว" → the member says something that
    // repeats the amount → a new slipless row is opened → the bot asks for a
    // slip it already has → the resent slip comes back as "รายการซ้ำ".
    expect(
      isRepeatOfLogged(
        { amount: 30000, category: "ชำระหนี้", hasSlip: false },
        logged(),
        NOW
      )
    ).toBe(true);
  });

  it("catches it when the repeat names no category", () => {
    // Typical of a follow-up: the amount comes back, the category does not.
    expect(
      isRepeatOfLogged({ amount: 30000, category: null, hasSlip: false }, logged(), NOW)
    ).toBe(true);
  });

  it("lets a slip through, always", () => {
    // The escape hatch, and the reason this rule can be strict. A second real
    // payment has its own slip; its hash either differs (a genuine second
    // payment, which must be logged) or matches (a true duplicate, which
    // reportTransaction's hash guard rejects with the right message). Neither
    // decision belongs here.
    expect(
      isRepeatOfLogged(
        { amount: 30000, category: "ชำระหนี้", hasSlip: true },
        logged(),
        NOW
      )
    ).toBe(false);
  });

  it("does not block a fresh conversation that names no amount", () => {
    // "อยากบันทึกซื้อหุ้นค่ะ" carries no amount and matches nothing. Telling
    // this member their payment was already recorded would be a worse bug
    // than the one being fixed.
    expect(
      isRepeatOfLogged({ amount: null, category: "ซื้อหุ้น", hasSlip: false }, logged(), NOW)
    ).toBe(false);
    expect(
      isRepeatOfLogged({ amount: null, category: null, hasSlip: false }, logged(), NOW)
    ).toBe(false);
  });

  it("does not block a different amount or a different category", () => {
    expect(
      isRepeatOfLogged({ amount: 5000, category: "ชำระหนี้", hasSlip: false }, logged(), NOW)
    ).toBe(false);
    expect(
      isRepeatOfLogged({ amount: 30000, category: "ซื้อหุ้น", hasSlip: false }, logged(), NOW)
    ).toBe(false);
  });

  it("lets go once the window has passed", () => {
    // A member paying the same amount again later in the day is doing exactly
    // that, not repeating themselves.
    const justInside = new Date(NOW.getTime() - REPEAT_WINDOW_MS + 1000);
    const justOutside = new Date(NOW.getTime() - REPEAT_WINDOW_MS - 1000);
    expect(
      isRepeatOfLogged(
        { amount: 30000, category: null, hasSlip: false },
        logged({ createdAt: justInside }),
        NOW
      )
    ).toBe(true);
    expect(
      isRepeatOfLogged(
        { amount: 30000, category: null, hasSlip: false },
        logged({ createdAt: justOutside }),
        NOW
      )
    ).toBe(false);
  });

  it("ignores a row dated in the future rather than trusting it", () => {
    // Clock skew between the app and the database would otherwise make a
    // future-dated row match forever.
    expect(
      isRepeatOfLogged(
        { amount: 30000, category: null, hasSlip: false },
        logged({ createdAt: new Date(NOW.getTime() + 60 * 1000) }),
        NOW
      )
    ).toBe(false);
  });

  it("does nothing when the member has logged nothing recently", () => {
    expect(
      isRepeatOfLogged({ amount: 30000, category: "ชำระหนี้", hasSlip: false }, null, NOW)
    ).toBe(false);
  });

  it("tolerates float noise on the amount", () => {
    expect(
      isRepeatOfLogged(
        { amount: 30000.001, category: null, hasSlip: false },
        logged(),
        NOW
      )
    ).toBe(true);
  });
});

describe("ALREADY_LOGGED_INSTRUCTION", () => {
  it("says nothing was held, so the model does not report a hold that is not there", () => {
    expect(ALREADY_LOGGED_INSTRUCTION).toContain("Nothing has been held");
  });

  it("leaves the member a way through if it was genuinely a second payment", () => {
    // The one case the rule can get wrong. It must not dead-end there.
    expect(ALREADY_LOGGED_INSTRUCTION).toContain("SECOND payment");
    expect(ALREADY_LOGGED_INSTRUCTION).toContain("send that second slip");
  });

  it("tells the model to say the amount back, so a wrong match is visible", () => {
    expect(ALREADY_LOGGED_INSTRUCTION).toContain("say the amount back");
  });
});
