// Staff-toggleable on/off switches, editable from the dashboard's "ตั้งค่า
// ระบบ" tab without a code deploy — see prisma/schema.prisma's FeatureFlag
// model for the rationale. Mirrors the lib/knowledge.ts pattern: a short
// in-memory cache so every webhook message doesn't hit the DB, and a safe
// fallback if the table is ever unreadable.
import { prisma } from "./prisma";
import { DEPARTMENTS } from "./departments";

export const MESSAGING_ENABLED = "messaging_enabled";
export const TRANSACTIONS_ENABLED = "transactions_enabled";
export const SERVICE_REQUESTS_ENABLED = "service_requests_enabled";
export const MEMBER_LOOKUP_ENABLED = "member_lookup_enabled";

export function departmentNotifyKey(department: string): string {
  return `dept_notify_${department}`;
}

export const DEFAULT_FLAGS: { key: string; label: string; enabled: boolean }[] = [
  {
    key: MESSAGING_ENABLED,
    label: "รับข้อความจากสมาชิก (ปิด = บอทเงียบทั้งหมด ให้เจ้าหน้าที่ตอบเองผ่าน chat.line.biz)",
    enabled: true,
  },
  {
    key: TRANSACTIONS_ENABLED,
    label: "รับบันทึกธุรกรรมจากสลิป",
    enabled: true,
  },
  {
    key: SERVICE_REQUESTS_ENABLED,
    label: "รับคำขอบริการ/ส่งต่อเจ้าหน้าที่",
    enabled: true,
  },
  {
    key: MEMBER_LOOKUP_ENABLED,
    label: "ค้นหาเลขสมาชิก (ยืนยันตัวตน)",
    enabled: true,
  },
  ...DEPARTMENTS.map((department) => ({
    key: departmentNotifyKey(department),
    label: `แจ้งเตือนแผนก ${department}`,
    enabled: true,
  })),
];

// Every isFeatureEnabled call within this window reuses the same read — a
// deliberately short TTL (unlike knowledge.ts's 60s) since a flag flip like
// maintenance mode should take effect quickly, while still sparing the DB a
// query on every single webhook message.
let cached: { flags: Map<string, boolean>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 1000;

async function loadFlags(): Promise<Map<string, boolean>> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.flags;
  }
  let flags: Map<string, boolean>;
  try {
    const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
    flags = new Map(rows.map((r) => [r.key, r.enabled]));
  } catch (err) {
    console.error("[featureFlags] read error, defaulting to all enabled:", err);
    flags = new Map();
  }
  cached = { flags, fetchedAt: Date.now() };
  return flags;
}

// Fails open: a missing key (e.g. a department added after the last seed)
// or a read error is treated as enabled — a flags outage or an unrecognized
// key must never silently disable the bot.
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flags = await loadFlags();
  return flags.get(key) ?? true;
}
