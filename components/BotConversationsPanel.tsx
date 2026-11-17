"use client";

import { useCallback, useEffect, useState } from "react";
import type { MessageFlag, ThreadFilter } from "@/lib/botConversations";

interface Handoff {
  id: string;
  kind: string;
  department: string | null;
  reason: string;
  status: string;
  notifiedTo: string | null;
  notifyError: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  reminderCount: number;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  exception: "ขออนุมัติ/ขอยกเว้น",
  money_dispute: "ร้องเรียนเรื่องเงิน",
  unclear: "บอทไม่แน่ใจว่าหมายถึงอะไร",
};

const NOTIFY_ERRORS: Record<string, string> = {
  muted: "ไม่ได้แจ้ง — ปิดแจ้งเตือนแผนกนี้ไว้ในตั้งค่าระบบ",
  unconfigured: "ไม่ได้แจ้ง — แผนกนี้ยังไม่มีผู้รับผิดชอบหรือกลุ่ม LINE",
};

interface Thread {
  lineUserId: string;
  name: string | null;
  displayName: string | null;
  memberNumber: string | null;
  lastAt: string;
  messages: { id: string; fromBot: boolean; text: string; createdAt: string; flag: MessageFlag }[];
  unanswered: number;
  failed: number;
  noInfo: number;
  handoffs: Handoff[];
  waiting: number;
}

interface Response {
  days: number;
  maxDays: number;
  truncated: boolean;
  counts: Record<ThreadFilter, number>;
  total: number;
  page: number;
  pageSize: number;
  threads: Thread[];
}

const FILTER_LABELS: { id: ThreadFilter; label: string; hint: string }[] = [
  { id: "all", label: "ทั้งหมด", hint: "" },
  {
    id: "waiting",
    label: "รอรับเรื่อง",
    hint: "บอทส่งเรื่องให้เจ้าหน้าที่แล้ว แต่ยังไม่มีใครกด \"รับเรื่องนี้\" ใน LINE — ถ้าตอบสมาชิกไปแล้ว กด \"ทำเครื่องหมายว่ารับแล้ว\" ได้",
  },
  {
    id: "unanswered",
    label: "บอทไม่ได้ตอบ",
    hint: "สมาชิกพิมพ์มาแล้วบอทไม่ได้ตอบก่อนข้อความถัดไป — บอทส่งต่อเจ้าหน้าที่ หรือปิดบอทไว้ ตรวจว่ามีคนตอบใน chat.line.biz แล้ว",
  },
  { id: "failed", label: "ตอบขัดข้อง", hint: "บอทตอบข้อความขอโทษเพราะประมวลผลไม่สำเร็จ" },
  { id: "noInfo", label: "ไม่มีข้อมูล", hint: "บอทบอกว่าไม่มีข้อมูลในระบบ — เพิ่มเรื่องนั้นในฐานความรู้" },
];

const FLAG_TAG: Record<Exclude<MessageFlag, null>, { label: string; cls: string }> = {
  unanswered: { label: "บอทไม่ได้ตอบ", cls: "bg-amber-100 text-amber-800" },
  failed: { label: "ตอบขัดข้อง", cls: "bg-red-100 text-red-700" },
  noInfo: { label: "ไม่มีข้อมูล", cls: "bg-sky-100 text-sky-800" },
};

const time = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function BotConversationsPanel() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ days: String(days), filter, search, page: String(page) });
      const res = await fetch(`/api/bot-conversations?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setError("โหลดบทสนทนาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [days, filter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const markClaimed = async (id: string) => {
    const res = await fetch(`/api/staff-handoffs/${id}`, { method: "PATCH" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "บันทึกไม่สำเร็จ");
    }
    load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hint = FILTER_LABELS.find((f) => f.id === filter)?.hint;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">บทสนทนาบอท</h2>
        <p className="text-xs text-slate-500 mt-1">
          สิ่งที่สมาชิกพิมพ์มาและสิ่งที่บอทตอบกลับ แยกตามสมาชิก ล่าสุดอยู่บน — ระบบเก็บไว้{" "}
          {data?.maxDays ?? 14} วันแล้วลบเอง สลิป/ไฟล์ที่ส่งมาแสดงเป็น &quot;[ส่งรูปภาพ]&quot; และข้อความที่เจ้าหน้าที่ตอบเองใน
          chat.line.biz ไม่อยู่ในหน้านี้
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100">
        {FILTER_LABELS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFilter(f.id);
              setPage(1);
            }}
            className={`text-sm rounded-full px-3 py-1 border ${
              filter === f.id
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
            {data ? <span className="ml-1 opacity-75">{data.counts[f.id] ?? 0}</span> : null}
          </button>
        ))}
        <select
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(1);
          }}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          aria-label="ช่วงเวลา"
        >
          <option value={1}>วันนี้-เมื่อวาน</option>
          <option value={3}>3 วัน</option>
          <option value={7}>7 วัน</option>
          <option value={14}>14 วัน</option>
        </select>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="ค้นหาชื่อ เลขสมาชิก หรือข้อความ"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-full sm:w-72"
        />
        <button
          type="button"
          onClick={load}
          className="text-sm text-slate-600 hover:text-slate-900 px-2 py-1"
          title="โหลดใหม่"
        >
          ↻ โหลดใหม่
        </button>
      </div>

      {hint ? <p className="text-xs text-slate-500 px-4 pt-2">{hint}</p> : null}
      {data?.truncated ? (
        <p className="text-xs text-amber-700 px-4 pt-2">แสดงเฉพาะข้อความล่าสุด 5,000 ข้อความ — เลือกช่วงเวลาให้สั้นลงเพื่อดูครบ</p>
      ) : null}
      {error ? <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p> : null}

      {loading && !data ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : data && data.threads.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          {search || filter !== "all" ? "ไม่มีบทสนทนาที่ตรงกับที่เลือก" : `ยังไม่มีบทสนทนาใน ${data.days} วันที่ผ่านมา`}
        </p>
      ) : (
        <ul className={`divide-y divide-slate-100 ${loading ? "opacity-60" : ""}`}>
          {data?.threads.map((t) => {
            const isOpen = open.has(t.lineUserId);
            const last = t.messages[t.messages.length - 1];
            return (
              <li key={t.lineUserId}>
                <button
                  type="button"
                  onClick={() => toggle(t.lineUserId)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start gap-3"
                  aria-expanded={isOpen}
                >
                  <span className="text-slate-400 mt-0.5">{isOpen ? "▾" : "▸"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{t.name ?? t.displayName ?? "ไม่ทราบชื่อ"}</span>
                      {t.memberNumber ? <span className="text-xs text-slate-500">เลขสมาชิก {t.memberNumber}</span> : null}
                      {t.name && t.displayName && t.displayName !== t.name ? (
                        <span className="text-xs text-slate-400">LINE: {t.displayName}</span>
                      ) : null}
                      <span className="text-xs text-slate-400">{t.messages.length} ข้อความ</span>
                      {t.waiting ? (
                        <span className="text-xs rounded px-1.5 py-0.5 bg-orange-100 text-orange-800">
                          รอรับเรื่อง {t.waiting}
                        </span>
                      ) : t.handoffs.length ? (
                        <span className="text-xs rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800">
                          รับเรื่องแล้ว
                        </span>
                      ) : null}
                      {t.unanswered ? <Tag flag="unanswered" n={t.unanswered} /> : null}
                      {t.failed ? <Tag flag="failed" n={t.failed} /> : null}
                      {t.noInfo ? <Tag flag="noInfo" n={t.noInfo} /> : null}
                    </span>
                    {!isOpen ? (
                      <span className="block text-sm text-slate-600 truncate mt-0.5">
                        {last.fromBot ? "🤖 " : ""}
                        {last.text}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{time(t.lastAt)}</span>
                </button>
                {isOpen ? (
                  <div className="px-4 pb-4 space-y-2 bg-slate-50/60">
                    {timeline(t).map((item) =>
                      item.handoff ? (
                        <HandoffRow key={item.handoff.id} h={item.handoff} onClaim={markClaimed} />
                      ) : (
                      <div key={item.m.id} className={`flex ${item.m.fromBot ? "justify-end" : "justify-start"}`}>
                        <div className="max-w-[85%] sm:max-w-[70%]">
                          <div
                            className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                              item.m.fromBot
                                ? "bg-emerald-600 text-white rounded-br-sm"
                                : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                            }`}
                          >
                            {item.m.text}
                          </div>
                          <div
                            className={`flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 ${
                              item.m.fromBot ? "justify-end" : ""
                            }`}
                          >
                            <span>{item.m.fromBot ? "บอท" : "สมาชิก"}</span>
                            <span>{time(item.m.createdAt)}</span>
                            {item.m.flag ? (
                              <span className={`rounded px-1.5 ${FLAG_TAG[item.m.flag].cls}`}>{FLAG_TAG[item.m.flag].label}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      )
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {data && pages > 1 ? (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-sm">
          <span className="text-slate-500">
            {data.total} คน · หน้า {data.page}/{pages}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40"
            >
              ถัดไป
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

type TimelineItem =
  | { handoff: null; m: Thread["messages"][number]; at: string }
  | { handoff: Handoff; m: null; at: string };

// Messages and handoffs in one line, in time order.
function timeline(t: Thread): TimelineItem[] {
  const items: TimelineItem[] = [
    ...t.messages.map((m) => ({ handoff: null, m, at: m.createdAt })),
    ...t.handoffs.map((h) => ({ handoff: h, m: null, at: h.createdAt })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

function HandoffRow({ h, onClaim }: { h: Handoff; onClaim: (id: string) => void }) {
  const open = h.status === "open";
  return (
    <div className="flex justify-center">
      <div
        className={`text-xs rounded-lg border px-3 py-2 max-w-[90%] ${
          open ? "bg-orange-50 border-orange-200 text-orange-900" : "bg-emerald-50 border-emerald-200 text-emerald-900"
        }`}
      >
        <div className="font-medium">
          🔔 ส่งเรื่องให้เจ้าหน้าที่ · {KIND_LABELS[h.kind] ?? h.kind}
          {h.department ? ` · แผนก${h.department}` : ""} · {time(h.createdAt)}
        </div>
        <div className="mt-0.5">{h.reason}</div>
        {h.notifyError ? (
          <div className="mt-0.5 text-red-700">⚠️ {NOTIFY_ERRORS[h.notifyError] ?? `แจ้งไม่สำเร็จ: ${h.notifyError}`}</div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <span>
                ⏳ ยังไม่มีใครรับเรื่อง{h.reminderCount ? ` (เตือนซ้ำแล้ว ${h.reminderCount} ครั้ง)` : ""}
              </span>
              <button
                type="button"
                onClick={() => onClaim(h.id)}
                className="rounded border border-orange-300 bg-white px-2 py-0.5 hover:bg-orange-100"
              >
                ทำเครื่องหมายว่ารับแล้ว
              </button>
            </>
          ) : (
            <span>
              ✅ รับเรื่องแล้วโดย {h.claimedBy ?? "เจ้าหน้าที่"}
              {h.claimedAt ? ` · ${time(h.claimedAt)}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ flag, n }: { flag: Exclude<MessageFlag, null>; n: number }) {
  const t = FLAG_TAG[flag];
  return (
    <span className={`text-xs rounded px-1.5 py-0.5 ${t.cls}`}>
      {t.label} {n}
    </span>
  );
}
