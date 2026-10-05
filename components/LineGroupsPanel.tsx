"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { GROUP_DEPARTMENTS } from "@/lib/lineGroupUsage";

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
  departments: string[];
  units: string[];
}

interface UnitOption {
  name: string;
  lineUserId: string | null;
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
  // The group whose จัดการ form is open, and what it is being set to.
  const [managing, setManaging] = useState<string | null>(null);
  const [draftDepartments, setDraftDepartments] = useState<string[]>([]);
  const [draftUnits, setDraftUnits] = useState<string[]>([]);
  const [unitQuery, setUnitQuery] = useState("");
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/line-groups");
      const body = await res.json();
      // A non-array means the request failed — most often because the
      // migration has not been deployed yet. Showing the reason matters:
      // an empty table reads as "no groups yet", which is a completely
      // different situation with a completely different fix.
      if (!res.ok || !Array.isArray(body)) {
        setError(body?.error ?? "โหลดรายชื่อกลุ่มไม่สำเร็จ");
        setGroups([]);
      } else {
        setGroups(body);
      }
    } catch {
      setError("โหลดรายชื่อกลุ่มไม่สำเร็จ");
      setGroups([]);
    }
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

  const openManage = async (group: LineGroup) => {
    if (managing === group.id) {
      setManaging(null);
      return;
    }
    setManaging(group.id);
    setDraftDepartments(group.departments);
    setDraftUnits(group.units);
    setUnitQuery("");
    setError(null);
    setNotice(null);
    if (unitOptions.length === 0) {
      const res = await fetch("/api/organization-units");
      const body = await res.json().catch(() => ({}));
      if (Array.isArray(body.data)) setUnitOptions(body.data);
    }
  };

  const addDraftUnit = () => {
    const name = unitQuery.trim();
    if (!name || draftUnits.includes(name)) return;
    if (!unitOptions.some((u) => u.name === name)) {
      setError(`ไม่พบหน่วยงาน "${name}" — เลือกจากรายการ`);
      return;
    }
    setError(null);
    setDraftUnits((prev) => [...prev, name]);
    setUnitQuery("");
  };

  const saveUsage = async (group: LineGroup) => {
    setBusy(group.id);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/line-groups/${group.id}/usage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departments: draftDepartments, units: draftUnits }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(body.error || "บันทึกไม่สำเร็จ");
      return;
    }
    setManaging(null);
    setUnitOptions([]);
    setNotice(`บันทึกการใช้งานกลุ่ม "${group.note ?? group.name ?? group.groupId}" แล้ว`);
    await fetchGroups();
  };

  const forgetGroup = async (group: LineGroup) => {
    setBusy(group.id);
    setError(null);
    const res = await fetch(`/api/line-groups/${group.id}/forget`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(body.error || "ลบไม่สำเร็จ");
      return;
    }
    setManaging(null);
    setNotice(`ลบกลุ่ม "${group.note ?? group.name ?? group.groupId}" ออกจากรายการแล้ว`);
    await fetchGroups();
  };

  // Units already sending to another LINE, which choosing them here replaces.
  const replacedTarget = (name: string, group: LineGroup) => {
    const unit = unitOptions.find((u) => u.name === name);
    return unit?.lineUserId && unit.lineUserId !== group.groupId ? unit.lineUserId : null;
  };
  const groupLabelOf = (lineId: string) => {
    const g = groups.find((x) => x.groupId === lineId);
    return g ? g.note ?? g.name ?? "กลุ่มอื่น" : "LINE รายคน";
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
            → กด <strong>"ทดสอบส่ง"</strong> ให้แน่ใจว่าส่งได้ → แล้วกด <strong>"⚙️ จัดการ"</strong>
            เลือกว่าจะให้กลุ่มนี้รับแจ้งของแผนกไหน หรือรับรายการหักของหน่วยงานไหน
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
                <Fragment key={group.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50">
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
                      onClick={() => openManage(group)}
                      disabled={busy === group.id}
                      className="text-sky-700 hover:underline disabled:opacity-40 mr-3"
                      aria-expanded={managing === group.id}
                    >
                      {managing === group.id ? "ปิด" : "⚙️ จัดการ"}
                    </button>
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
                {managing === group.id && (
                  <tr className="bg-sky-50/40 border-t border-sky-100">
                    <td colSpan={5} className="px-4 py-3 space-y-3 text-sm">
                      {group.leftAt && (
                        <p className="text-xs text-red-700">
                          บอทไม่อยู่ในกลุ่มนี้แล้ว — ข้อความที่ส่งเข้ากลุ่มนี้ไปไม่ถึงใคร เอาแผนก/หน่วยงานออก
                          แล้วตั้งผู้รับใหม่ หรือให้คนในกลุ่มเชิญบอทกลับเข้ามา
                        </p>
                      )}
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-1">
                          รับคำขอบริการของแผนก (สินเชื่อใช้กลุ่มไม่ได้)
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {GROUP_DEPARTMENTS.map((d) => {
                            const checked = draftDepartments.includes(d);
                            return (
                              <label key={d} className="inline-flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!!group.leftAt && !checked}
                                  onChange={() =>
                                    setDraftDepartments((prev) =>
                                      checked ? prev.filter((x) => x !== d) : [...prev, d]
                                    )
                                  }
                                />
                                {d}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-1">ส่งรายการหักของหน่วยงาน</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {draftUnits.length === 0 && <span className="text-xs text-slate-400">— ไม่มี —</span>}
                          {draftUnits.map((name) => {
                            const replaced = replacedTarget(name, group);
                            return (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded-full pl-2.5 pr-1 py-0.5 text-xs"
                                title={replaced ? `ตอนนี้ส่งไปที่ ${groupLabelOf(replaced)} — บันทึกแล้วจะเปลี่ยนมาส่งเข้ากลุ่มนี้แทน` : undefined}
                              >
                                {name}
                                {replaced && <span className="text-amber-700">(แทน {groupLabelOf(replaced)})</span>}
                                <button
                                  type="button"
                                  onClick={() => setDraftUnits((prev) => prev.filter((x) => x !== name))}
                                  className="text-slate-400 hover:text-red-600 px-1"
                                  aria-label={`เอา ${name} ออก`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                        {!group.leftAt && (
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <input
                              list={`units-${group.id}`}
                              value={unitQuery}
                              onChange={(e) => setUnitQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") addDraftUnit();
                              }}
                              placeholder="พิมพ์ชื่อหน่วยงาน…"
                              className="border border-slate-300 rounded px-2 py-1 text-xs w-64 bg-white"
                            />
                            <datalist id={`units-${group.id}`}>
                              {unitOptions
                                .filter((u) => !draftUnits.includes(u.name))
                                .map((u) => (
                                  <option key={u.name} value={u.name} />
                                ))}
                            </datalist>
                            <button
                              type="button"
                              onClick={addDraftUnit}
                              disabled={!unitQuery.trim()}
                              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white hover:bg-slate-50 disabled:opacity-40"
                            >
                              + เพิ่มหน่วยงาน
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => saveUsage(group)}
                          disabled={busy === group.id}
                          className="text-xs text-white bg-slate-900 rounded px-3 py-1.5 disabled:opacity-50"
                        >
                          {busy === group.id ? "กำลังบันทึก…" : "บันทึก"}
                        </button>
                        <button onClick={() => setManaging(null)} className="text-xs text-slate-500 hover:underline">
                          ยกเลิก
                        </button>
                        {group.leftAt && (
                          <button
                            onClick={() => forgetGroup(group)}
                            disabled={busy === group.id || group.usedBy.length > 0}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40 ml-auto"
                            title={
                              group.usedBy.length > 0
                                ? "เอาแผนก/หน่วยงานออกแล้วกดบันทึกก่อน"
                                : "ลบกลุ่มนี้ออกจากตาราง — ถ้าเชิญบอทกลับเข้ากลุ่ม กลุ่มจะขึ้นมาใหม่เอง"
                            }
                          >
                            🗑️ ลบออกจากรายการ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
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
