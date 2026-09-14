// Why a push to staff failed, in words a person can act on.
//
// Two forwards failed on 11 Sep — a ฿2,000 transaction and a loan request —
// and the dashboard said only "ส่งต่อไม่สำเร็จ" for both. The reason existed:
// LINE returns a status and a message, and pushToTargets logged it. It went
// to a Vercel log nobody reads, and the row a person actually looks at kept
// none of it.
//
// That is the difference between "ring the office and hope" and "the officer
// has not added the OA as a friend, add them and it works". Each of the
// causes below needs a different person to do a different thing, and the
// status code already says which.
//
// A member never sees any of this. It is written on the row for staff.

export interface PushErrorSummary {
  // Short Thai sentence naming the cause, for the dashboard.
  reason: string;
  // The HTTP status LINE returned, when there was one.
  status: number | null;
}

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; statusCode?: unknown; originalError?: unknown };
  for (const value of [e.status, e.statusCode]) {
    if (typeof value === "number") return value;
  }
  // Older SDK shapes wrap the response one level down.
  if (e.originalError && typeof e.originalError === "object") {
    const inner = (e.originalError as { response?: { status?: unknown } }).response;
    if (inner && typeof inner.status === "number") return inner.status;
  }
  return null;
}

function messageOf(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "");
  const e = err as { body?: unknown; message?: unknown };
  if (typeof e.body === "string" && e.body.trim()) return e.body.trim();
  if (e.body && typeof e.body === "object") {
    const message = (e.body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return typeof e.message === "string" ? e.message : "";
}

// Kept short: this lands in a table cell and a tooltip, not a page.
const LIMIT = 300;

/**
 * What to write on the row. Never throws — a failure to describe a failure
 * must not become a second failure.
 */
export function describePushError(err: unknown): PushErrorSummary {
  const status = statusOf(err);
  const raw = messageOf(err);
  const detail = raw ? ` (${raw})` : "";

  // 429 is the one that fails every push at once rather than one recipient's,
  // which is what two unrelated forwards failing on the same day looks like.
  if (status === 429) {
    return {
      status,
      reason: `ส่งข้อความไม่ได้ — โควตาข้อความของ LINE OA เต็มแล้ว หรือถูกจำกัดอัตราการส่งชั่วคราว${detail}`,
    };
  }
  if (status === 403) {
    return {
      status,
      reason: `ส่งไม่ได้ — เจ้าหน้าที่คนนี้ยังไม่ได้เพิ่ม LINE OA เป็นเพื่อน หรือบล็อกไว้${detail}`,
    };
  }
  if (status === 400) {
    return {
      status,
      reason: `ส่งไม่ได้ — LINE UserID ของผู้รับไม่ถูกต้อง หรือรูปแบบข้อความผิด${detail}`,
    };
  }
  if (status === 401) {
    return { status, reason: `ส่งไม่ได้ — Channel access token ไม่ถูกต้องหรือหมดอายุ${detail}` };
  }
  if (status !== null && status >= 500) {
    return { status, reason: `ส่งไม่ได้ — ระบบของ LINE ขัดข้องชั่วคราว ลองส่งใหม่ภายหลัง${detail}` };
  }

  const fallback = raw || "ไม่ทราบสาเหตุ";
  return {
    status,
    reason: `ส่งไม่ได้ — ${fallback}`.slice(0, LIMIT),
  };
}

/**
 * One line for a whole attempt, so a row where two of three recipients failed
 * says so rather than showing only the last error.
 */
export function summarisePushFailures(errors: unknown[]): string | null {
  if (errors.length === 0) return null;

  const described = errors.map(describePushError);
  const distinct = [...new Set(described.map((d) => d.reason))];
  const joined = distinct.join(" | ");
  return (
    errors.length > 1 ? `ล้มเหลว ${errors.length} ปลายทาง: ${joined}` : joined
  ).slice(0, LIMIT);
}
