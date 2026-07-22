import { describe, expect, it } from "vitest";
import { detectNamedDepartment } from "../lib/departmentMatch";

describe("detectNamedDepartment", () => {
  it("matches a department named on its own", () => {
    expect(detectNamedDepartment("ส่งสารสนเทศ")).toBe("สารสนเทศ");
  });

  it("matches a department named with a prefix like ฝ่าย/แผนก", () => {
    expect(detectNamedDepartment("ติดต่อฝ่ายบัญชี")).toBe("บัญชี");
    expect(detectNamedDepartment("แผนกสวัสดิการ")).toBe("สวัสดิการ");
  });

  it("returns null when no department is named", () => {
    expect(detectNamedDepartment("ขอกู้เงินสามัญ")).toBeNull();
    expect(detectNamedDepartment("สมัครสมาชิกใหม่")).toBeNull();
  });

  it("never force-matches the อื่นๆ catch-all", () => {
    expect(detectNamedDepartment("อื่นๆ ครับ")).toBeNull();
  });

  it("does not false-positive on unrelated text", () => {
    expect(detectNamedDepartment("ขอสอบถามเรื่องดอกเบี้ย")).toBeNull();
  });
});
