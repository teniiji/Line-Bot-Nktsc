// Blocked outright: the cooperative's own official domain, currently
// suspected of serving different (gambling-spam) content to LINE's
// link-preview fetcher than to a normal browser — see lib/links.ts. Staff
// should host forms somewhere else (Google Drive, etc.) until that's
// resolved. Shared by both app/api/form-links routes (create + update).
export const BLOCKED_FORM_LINK_HOSTS = new Set(["nktscoop.com", "www.nktscoop.com"]);

// Returns an error message in Thai if the URL should be rejected, or null
// if it's fine to save.
export function validateFormLinkUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย http:// หรือ https://";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// เท่านั้น";
  }
  if (BLOCKED_FORM_LINK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return "ห้ามใช้โดเมนเว็บสหกรณ์เอง (nktscoop.com) เนื่องจากตรวจพบปัญหาความปลอดภัย — ใช้ Google Drive หรือที่เก็บไฟล์อื่นแทน";
  }
  return null;
}
