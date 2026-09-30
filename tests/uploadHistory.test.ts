import { describe, expect, it } from "vitest";
import { previousUploadWarning } from "../lib/uploadHistory";

const when = (iso: string) => iso.slice(0, 10);
const up = (over: Partial<{ kind: string; fileName: string; uploadedAt: string; sameContent: boolean }>) => ({
  kind: "results",
  fileName: "เลย_ไม่ได้.xlsx",
  uploadedAt: "2026-09-28T03:00:00.000Z",
  sameContent: true,
  ...over,
});

describe("previousUploadWarning", () => {
  it("says nothing for a file new to the round", () => {
    expect(previousUploadWarning([], "results", when)).toBeNull();
    // Loaded before as the other kind of file only.
    expect(previousUploadWarning([up({ kind: "list" })], "results", when)).toBeNull();
  });

  it("says when the same file was loaded before, and that loading it again counts nothing twice", () => {
    const text = previousUploadWarning([up({})], "results", when) as string;
    expect(text).toMatch(/^⚠️ ไฟล์นี้เคยอัปเข้ารอบนี้แล้วเมื่อ 2026-09-28/);
    expect(text).toMatch(/ไม่นับซ้ำ/);
  });

  it("tells a corrected file under the same name from the same file again", () => {
    const text = previousUploadWarning(
      [up({ sameContent: false, uploadedAt: "2026-09-29T03:00:00.000Z" }), up({ sameContent: false })],
      "results",
      when
    ) as string;
    expect(text).toMatch(/^ℹ️ ไฟล์ชื่อ "เลย_ไม่ได้.xlsx" เคยอัปเข้ารอบนี้เมื่อ 2026-09-29 \(อัปมาแล้ว 2 ครั้ง\)/);
    expect(text).toMatch(/เนื้อหาต่างจากครั้งก่อน/);
  });
});
