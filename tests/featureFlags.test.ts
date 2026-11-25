import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  departmentNotifyKey,
  MESSAGING_ENABLED,
  TRANSACTIONS_ENABLED,
  SERVICE_REQUESTS_ENABLED,
  MEMBER_LOOKUP_ENABLED,
  ASK_MEMBER_INFO_ENABLED,
  ASK_CATEGORY_ENABLED,
  ASK_LOAN_TYPE_ENABLED,
  ASK_DEPOSIT_ACCOUNT_ENABLED,
  ASK_CONFIRM_SENDER_NAME_ENABLED,
} from "../lib/featureFlags";
import { DEPARTMENTS } from "../lib/departments";

describe("departmentNotifyKey", () => {
  it("prefixes the department name, including one containing a slash", () => {
    expect(departmentNotifyKey("สินเชื่อ")).toBe("dept_notify_สินเชื่อ");
    expect(departmentNotifyKey("บริหารสำนักงาน/ธุรการ")).toBe(
      "dept_notify_บริหารสำนักงาน/ธุรการ"
    );
  });
});

describe("DEFAULT_FLAGS", () => {
  it("has a unique key per entry (FeatureFlag.key is a DB unique column)", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes all four global switches", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.key);
    expect(keys).toContain(MESSAGING_ENABLED);
    expect(keys).toContain(TRANSACTIONS_ENABLED);
    expect(keys).toContain(SERVICE_REQUESTS_ENABLED);
    expect(keys).toContain(MEMBER_LOOKUP_ENABLED);
  });

  it("includes all five per-question toggles for the transaction flow", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.key);
    expect(keys).toContain(ASK_MEMBER_INFO_ENABLED);
    expect(keys).toContain(ASK_CATEGORY_ENABLED);
    expect(keys).toContain(ASK_LOAN_TYPE_ENABLED);
    expect(keys).toContain(ASK_DEPOSIT_ACCOUNT_ENABLED);
    expect(keys).toContain(ASK_CONFIRM_SENDER_NAME_ENABLED);
  });

  it("includes exactly one notify flag per department in DEPARTMENTS", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.key);
    for (const department of DEPARTMENTS) {
      expect(keys).toContain(departmentNotifyKey(department));
    }
    const deptFlagCount = DEFAULT_FLAGS.filter((f) => f.key.startsWith("dept_notify_")).length;
    expect(deptFlagCount).toBe(DEPARTMENTS.length);
  });

  it("defaults every switch to enabled (unchanged behavior right after deploy)", () => {
    // Except one turned off on purpose: staff asked for deduction-payment
    // slips to stop being pushed to the loan officer.
    expect(
      DEFAULT_FLAGS.filter((f) => f.key !== "category_notify_ชำระเก็บไม่ได้รายเดือน").every((f) => f.enabled === true)
    ).toBe(true);
  });
});

describe("per-category forwarding", () => {
  it("lists the deduction-slip switch, off by default", async () => {
    const { DEFAULT_FLAGS, DEDUCTION_SLIP_NOTIFY, categoryNotifyKey } = await import("../lib/featureFlags");
    expect(DEDUCTION_SLIP_NOTIFY).toBe(categoryNotifyKey("ชำระเก็บไม่ได้รายเดือน"));
    expect(DEFAULT_FLAGS.find((f) => f.key === DEDUCTION_SLIP_NOTIFY)?.enabled).toBe(false);
  });
});
