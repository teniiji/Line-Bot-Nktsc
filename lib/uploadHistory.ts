// Saying, before a รายการหัก or ผลการหัก file is applied, that it has been
// loaded into this round before. Applying it again is harmless — the round is
// updated, not added to — but staff asked to be told, because a unit's file
// that arrives twice (by LINE and by email) otherwise looks like new results.

export interface PreviousUpload {
  kind: string;
  fileName: string;
  uploadedAt: string;
  // The very same bytes, not just the same name.
  sameContent: boolean;
}

// The warning shown in the preview, or null when this file is new to the
// round. `when` formats a timestamp for the reader (Thai wall clock).
export function previousUploadWarning(
  previous: PreviousUpload[],
  kind: string,
  when: (iso: string) => string
): string | null {
  const mine = previous
    .filter((p) => p.kind === kind)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  if (mine.length === 0) return null;
  const same = mine.find((p) => p.sameContent);
  const times = mine.length > 1 ? ` (อัปมาแล้ว ${mine.length} ครั้ง)` : "";
  if (same) {
    return (
      `⚠️ ไฟล์นี้เคยอัปเข้ารอบนี้แล้วเมื่อ ${when(same.uploadedAt)}` +
      (same.fileName ? ` ชื่อ "${same.fileName}"` : "") +
      times +
      " — เนื้อหาเหมือนเดิมทุกอย่าง อัปซ้ำได้ ระบบจะอัปเดตผลเดิม ไม่นับซ้ำ"
    );
  }
  const latest = mine[0];
  return (
    `ℹ️ ไฟล์ชื่อ "${latest.fileName}" เคยอัปเข้ารอบนี้เมื่อ ${when(latest.uploadedAt)}` +
    times +
    " แต่เนื้อหาต่างจากครั้งก่อน — ถ้าเป็นไฟล์ที่หน่วยงานแก้แล้วส่งมาใหม่ บันทึกได้เลย"
  );
}
