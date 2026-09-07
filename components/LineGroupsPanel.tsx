"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

interface LineGroup {
  id: string;
  groupId: string;
  kind: string;
  name: string | null;
  note: string | null;
  joinedAt: string;
  leftAt: string | null;
  lastSeenAt: string;
  usedBy: string[];
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });

export default function LineGroupsPanel() {
  const [groups, setGroups] = useState<LineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingLeave, setPendingLeave] = useState<LineGroup | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/line-groups");
    setGroups(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const testSend = async (group: LineGroup) => {
    setBusy(group.id);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/line-groups/${group.id}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setError(body.error || "ส่งไม่สำเร็จ");
    else setNotice(`ส่งข้อความทดสอบเข้ากลุ่ม "${group.name ?? group.groupId}" แล้ว`);
    await fetchGroups();
  };

  const leaveGroup = async (group: LineGroup) => {
    setBusy(group.id);
    setPendingLeave(null);
    await fetch(`/api/line-groups/${group.id}`, { method: "DELETE" });
    setBusy(null);
    setNotice("นำบอทออกจากกลุ่มแล้ว");
    await fetchGroups();
  };

  const saveNote = async (group: LineGroup) => {
    setBusy(group.id);
    await fetch("/api/line-groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: group.id, note: noteDraft }),
    });
    setBusy(null);
    setEditing(null);
    await fetchGroups();
  };

  const active = groups.filter((g) => !g.leftAt);
  const gone = groups.filter((g) => g.leftAt);

  return (
    <section className="bg-white rounded-lg border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">กลุ่ม LINE ที่บอทอยู่</h2>
        <p className="text-xs text-slate-500 mt-1">
          ใช้ส่งแจ้งเตือน/เอกสารเข้า<strong>กลุ่ม</strong>แทนที่จะส่งหาคนคนเดียว —
          คนลา ย้าย หรือลาออก งานก็ไม่ค้าง และเพิ่มคนใหม่แค่ลากเข้ากลุ่ม ไม่ต้องมาแก้ที่นี่
        </p>
        <div className="text-xs text-slate-500 mt-2 space-y-1">
          <p>
            <strong>วิธีเพิ่มกลุ่ม:</strong> เชิญ LINE OA ของสหกรณ์เข้ากลุ่มนั้น → กลุ่มจะขึ้นในตารางนี้เอง
            → กด <strong>"ทดสอบส่ง"</strong> ให้แน่ใจว่าส่งได้ → แล้วค่อยไปเลือกใช้ที่แท็บ "รายการหัก"
            (หน่วยงาน) หรือ "ผู้รับผิดชอบ" (แผนก)
          </p>
          <p className="text-amber-700">
            ⚠️ ต้องเปิด <strong>"อนุญาตให้เชิญเข้ากลุ่ม"</strong> ใน LINE OA Manager ก่อน ไม่งั้นเชิญไม่เข้า
            — และเมื่อเปิดแล้ว <strong>ใครก็เชิญบอทเข้ากลุ่มไหนก็ได้</strong> กลุ่มที่โผล่มาในตารางนี้จึง
            <strong>ยังไม่ได้รับอะไรทั้งนั้น</strong> จนกว่าจะถูกเลือกใช้
          </p>
          <p>
            บอท<strong>ไม่อ่านและไม่ตอบข้อความในกลุ่ม</strong> ส่งอย่างเดียว —
            สมาชิกยังต้องทักแชทส่วนตัวเหมือนเดิม
          </p>
          <p className="text-slate-400">
            หมายเหตุ: LINE ไม่เปิดให้ดึงรายชื่อคนในกลุ่ม ระบบจึงบันทึกได้แค่ว่า "ส่งเข้ากลุ่มนี้"
            ไม่ใช่ว่าใครเห็นบ้าง — กลุ่มที่ใช้รับข้อมูลสมาชิกควรคุมคนเข้าให้ดี
          </p>
        </div>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
      {notice && <p className="px-4 py-2 text-sm text-green-700">{notice}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : groups.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center px-4">
          ยังไม่มีกลุ่ม — เชิญ LINE OA ของสหกรณ์เข้ากลุ่มที่ต้องการ แล้วกลุ่มจะขึ้นที่นี่เอง
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5 font-semibold min-w-[12rem]">ชื่อกลุ่ม</th>
                <th className="px-4 py-2.5 font-semibold">ใช้ส่งอะไรอยู่</th>
                <th className="px-4 py-2.5 font-semibold">เพิ่มเมื่อ</th>
                <th className="px-4 py-2.5 font-semibold">สถานะ</th>
                <th className="px-4 py-2.5 font-semibold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...gone].map((group) => (
                <tr key={group.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div>{group.name ?? <span className="text-slate-400">ไม่มีชื่อ</span>}</div>
                    {editing === group.id ? (
                      <span className="inline-flex items-center gap-2 mt-1">
                        <input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveNote(group);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          placeholder="เช่น การเงิน สพป.นค.1"
                          autoFocus
                          className="border border-slate-300 rounded px-2 py-1 text-xs w-52"
                        />
                        <button
                          onClick={() => saveNote(group)}
                          className="text-xs text-slate-900 hover:underline"
                        >
                          บันทึก
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditing(group.id);
                          setNoteDraft(group.note ?? "");
                        }}
                        className="text-xs text-slate-400 hover:underline mt-0.5"
                      >
                        {group.note ?? "+ ตั้งชื่อเรียกเอง"}
                      </button>
                    )}
                    <div className="font-mono text-[11px] text-slate-300 mt-0.5">
                      {group.groupId}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {group.usedBy.length === 0 ? (
                      <span className="text-slate-400">— ยังไม่ได้ใช้ —</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {group.usedBy.map((use) => (
                          <li key={use} className="text-slate-700">
                            {use}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-2.5 num text-slate-500 whitespace-nowrap">
                    {formatDate(group.joinedAt)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {group.leftAt ? (
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium border bg-red-50 text-red-700 border-red-200">
                        ❌ บอทไม่อยู่แล้ว
                      </span>
                    ) : (
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium border bg-green-50 text-green-700 border-green-200">
                        ✅ อยู่ในกลุ่ม
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => testSend(group)}
                      disabled={busy === group.id}
                      className="text-slate-900 hover:underline disabled:opacity-40"
                    >
                      ทดสอบส่ง
                    </button>
                    {!group.leftAt && (
                      <button
                        onClick={() => setPendingLeave(group)}
                        disabled={busy === group.id}
                        className="text-red-600 hover:underline disabled:opacity-40 ml-3"
                      >
                        นำบอทออก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingLeave && (
        <ConfirmDialog
          open
          title="นำบอทออกจากกลุ่ม?"
          description={
            `บอทจะออกจากกลุ่ม "${pendingLeave.name ?? pendingLeave.groupId}" และหยุดส่งแจ้งเตือนเข้ากลุ่มนี้ทันที` +
            (pendingLeave.usedBy.length > 0
              ? ` — กลุ่มนี้กำลังใช้รับ ${pendingLeave.usedBy.join(", ")} ต้องไปตั้งผู้รับใหม่ด้วย`
              : "") +
            " บอทเพิ่มตัวเองกลับเข้ากลุ่มไม่ได้ ต้องให้คนในกลุ่มเชิญเข้าใหม่"
          }
          confirmLabel="นำบอทออก"
          onConfirm={() => leaveGroup(pendingLeave)}
          onCancel={() => setPendingLeave(null)}
        />
      )}
    </section>
  );
}
