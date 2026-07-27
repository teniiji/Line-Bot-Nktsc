// Hosts blocked outright from FormLink URLs. Empty for now: nktscoop.com
// (the cooperative's own domain) was blocked here after LINE's link-preview
// fetcher rendered gambling-spam content for it (see lib/links.ts) — staff
// have since confirmed that's resolved, so it's no longer listed. Kept as a
// named set (mirroring lib/links.ts's ALLOWED_LINK_HOSTS pattern) so a
// future domain can be blocked the same way without restructuring this
// file. Shared by both app/api/form-links routes (create + update).
export const BLOCKED_FORM_LINK_HOSTS = new Set<string>([]);

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
