import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../lib/categories";
import { CATEGORY_DEPARTMENTS, getCategoryDepartment } from "../lib/categoryDepartments";

describe("CATEGORY_DEPARTMENTS", () => {
  it("maps every transaction category to a non-empty department", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_DEPARTMENTS[category]).toBeTruthy();
    }
  });

  it("has no stray keys beyond the current category list", () => {
    expect(Object.keys(CATEGORY_DEPARTMENTS).sort()).toEqual([...CATEGORIES].sort());
  });
});

describe("getCategoryDepartment", () => {
  it("resolves a known category", () => {
    expect(getCategoryDepartment("ฝากเงิน")).toBe("เงินฝาก");
  });

  it("resolves ชำระเก็บไม่ได้รายเดือน to สินเชื่อ (per-member loan routing)", () => {
    expect(getCategoryDepartment("ชำระเก็บไม่ได้รายเดือน")).toBe("สินเชื่อ");
  });

  it("returns null for an unrecognized category", () => {
    expect(getCategoryDepartment("ไม่มีจริง")).toBeNull();
  });
});
