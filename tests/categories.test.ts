import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  OTHER_CATEGORY,
  STAFF_CATEGORIES,
  categoryNeedsDetail,
  isStaffCategory,
  staffCategoryProblem,
  type StaffCategory,
} from "../lib/categories";

describe("STAFF_CATEGORIES", () => {
  it("is the cooperative's eleven plus the way out", () => {
    expect(STAFF_CATEGORIES).toHaveLength(CATEGORIES.length + 1);
    expect(STAFF_CATEGORIES).toContain(OTHER_CATEGORY);
    for (const category of CATEGORIES) expect(isStaffCategory(category)).toBe(true);
  });

  it("keeps อื่นๆ out of the list the bot works from", () => {
    // Every enum the agent offers is built from CATEGORIES. A member given
    // อื่นๆ will reach for it, and the answer that routes the payment to a
    // department would be lost — so the escape hatch is for the desk only.
    expect(CATEGORIES).not.toContain(OTHER_CATEGORY);
  });

  it("puts the eleven first, so nothing about the ordinary form changes", () => {
    // STAFF_CATEGORIES[0] is the manual form's default. Moving it would
    // quietly change what a distracted save files a payment as.
    expect(STAFF_CATEGORIES[0]).toBe(CATEGORIES[0]);
    expect(STAFF_CATEGORIES.at(-1)).toBe(OTHER_CATEGORY);
  });

  it("has a colour for everything a chart can be asked to draw", () => {
    for (const category of STAFF_CATEGORIES) {
      expect(CATEGORY_COLORS[category as StaffCategory]).toBeTruthy();
    }
  });
});

describe("staffCategoryProblem", () => {
  it("accepts one of the eleven with or without detail", () => {
    expect(staffCategoryProblem("ฝากเงิน", "")).toBeNull();
    expect(staffCategoryProblem("ฝากเงิน", "ชำระผ่านเคาน์เตอร์")).toBeNull();
  });

  it("accepts อื่นๆ when it says what the money was", () => {
    expect(staffCategoryProblem(OTHER_CATEGORY, "ค่าธรรมเนียมออกเอกสาร")).toBeNull();
  });

  it("refuses อื่นๆ with nothing written against it", () => {
    // The label alone says nothing. Filing it blank loses the answer at the
    // one moment somebody actually knew it.
    expect(staffCategoryProblem(OTHER_CATEGORY, "")).toContain("ระบุ");
    expect(staffCategoryProblem(OTHER_CATEGORY, "   \n ")).not.toBeNull();
  });

  it("refuses a category nobody has heard of", () => {
    expect(staffCategoryProblem("ค่ากาแฟ", "อธิบายไว้ละเอียดมาก")).not.toBeNull();
    expect(staffCategoryProblem("", "")).not.toBeNull();
  });

  it("asks for detail on อื่นๆ alone", () => {
    expect(categoryNeedsDetail(OTHER_CATEGORY)).toBe(true);
    for (const category of CATEGORIES) expect(categoryNeedsDetail(category)).toBe(false);
  });
});
