"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatAmount } from "@/lib/format";

// The units that pay for members in one transfer, and whom each pays for —
// what lets the เงินเข้าประจำวัน page recognise a unit's next transfer (see
// lib/unitPayerStore.ts). Built up by "บันทึกรายการ" and "แบ่งให้หลายคน";
// this is where a member recorded against the wrong unit comes off, one it
// has started paying for goes on, and a unit gets a name staff recognise.

interface UnitMember {
  id: string;
  memberNumber: string;
  name: string | null;
  lastAmount: number | null;
  viaOffice: string | null;
}

interface OfficeRef {
  name: string;
  count: number;
}

interface Unit {
  id: string;
  key: string;
  name: string;
  mode: "none" | "auto" | "split";
  members: UnitMember[];
  // Out-of-province offices linked to this unit (lib/unitPayerOffices.ts).
  offices: OfficeRef[];
  suggestions: { office: string; overlap: number; size: number }[];
}

const MODE_TEXT: Record<Unit["mode"], { label: string; className: string; title: string }> = {
  auto: {
    label: "จับคู่ให้อัตโนมัติ",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    title: "มีสมาชิกคนเดียว — ยอดที่หน่วยงานนี้โอนมาจะขึ้นเป็นของสมาชิกคนนี้เลย",
  },
  split: {
    label: "แบ่งให้หลายคน",
    className: "bg-sky-50 text-sky-700 border-sky-200",
    title: 'มีหลายคน — ยอดที่หน่วยงานนี้โอนมาต้องกด "แบ่งให้หลายคน" รายชื่อนี้จะขึ้นมาให้',
  },
  none: {
    label: "ยังไม่มีสมาชิก",
    className: "bg-slate-50 text-slate-500 border-slate-200",
    title: "เพิ่มสมาชิกก่อน ระบบถึงจะจำยอดของหน่วยงานนี้ได้",
  },
};

export default function UnitPayersPanel() {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [addMember, setAddMember] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [amountEdits, setAmountEdits] = useState<Record<string, string>>({});
  const [newDescription, setNewDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Unit | null>(null);
  const [officeChoices, setOfficeChoices] = useState<(OfficeRef & { linkedTo: string | null })[]>([]);
  const [officePick, setOfficePick] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const res = await fetch(`/api/unit-payers${q}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "โหลดรายชื่อหน่วยงานไม่สำเร็จ");
        return;
      }
      setUnits(body.data ?? []);
      setOfficeChoices(body.offices ?? []);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [open, load]);

  // Every write goes through here: one busy flag, one place errors land, and
  // the list re-read afterwards so it always shows what is stored.
  const call = async (url: string, init: RequestInit, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        ...init,
        headers: init.body ? { "Content-Type": "application/json" } : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return null;
      }
      if (done) setNotice(done);
      await load();
      return body;
    } finally {
      setBusy(false);
    }
  };

  const createUnit = async () => {
    const body = await call(
      "/api/unit-payers",
      { method: "POST", body: JSON.stringify({ description: newDescription, name: newName }) },
      "เพิ่มหน่วยงานแล้ว — ยอดของหน่วยงานนี้จะอยู่ใน \"เงินเข้าที่ไม่รู้ว่าใครโอน\" ให้บันทึกหรือแบ่ง · เพิ่มสมาชิกที่หน่วยงานนี้โอนให้ได้เลย"
    );
    if (body) {
      setNewDescription("");
      setNewName("");
      setExpanded(body.id);
    }
  };

  const addToUnit = async (unit: Unit) => {
    const body = await call(`/api/unit-payers/${unit.id}/members`, {
      method: "POST",
      body: JSON.stringify({ memberNumber: addMember, lastAmount: addAmount }),
    });
    if (body) {
      setNotice(
        body.inRoster
          ? `เพิ่ม ${addMember.trim()} ${body.name ?? ""} เข้า ${unit.name} แล้ว`
          : `เพิ่ม ${addMember.trim()} เข้า ${unit.name} แล้ว — ⚠️ ไม่พบเลขนี้ในทะเบียนสมาชิก ตรวจว่าพิมพ์ถูกไหม`
      );
      setAddMember("");
      setAddAmount("");
    }
  };

  const linkOffice = async (unit: Unit, office: string) => {
    const body = await call(`/api/unit-payers/${unit.id}/offices`, {
      method: "POST",
      body: JSON.stringify({ office }),
    });
    if (body) {
      setOfficePick("");
      setNotice(`ผูก "${office}" กับ ${unit.name} แล้ว — เพิ่มสมาชิก ${body.added} คนจากรายชื่อต่างจังหวัด`);
    }
  };

  const unlinkOffice = async (unit: Unit, office: string) => {
    const body = await call(`/api/unit-payers/${unit.id}/offices?office=${encodeURIComponent(office)}`, {
      method: "DELETE",
    });
    if (body) {
      setNotice(
        `ยกเลิกการผูก "${office}" แล้ว — เอาสมาชิกที่มาจากการผูกออก ${body.removed} คน ` +
          "(คนที่เคยบันทึกยอดไว้ยังอยู่)"
      );
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">🏢 หน่วยงานที่โอนแทนสมาชิก</h2>
          <p className="text-xs text-slate-500 mt-1">
            ยอดที่หน่วยงานโอนมาไม่มีเลขบัญชีผู้โอน ระบบจึงจำจากชื่อหน่วยงานในสเตทเมนต์แทน — หน่วยงานที่มี
            <strong>สมาชิกคนเดียว</strong> ยอดเดือนต่อไปจะขึ้นเป็นของคนนั้นเลย ส่วนที่มี<strong>หลายคน</strong>
            กด "แบ่งให้หลายคน" แล้วรายชื่อนี้จะขึ้นมาให้ · ส่วนใหญ่ไม่ต้องมากรอกเอง
            ระบบจำให้ตอนกด "บันทึกรายการ" หรือ "แบ่งให้หลายคน" ที่หน้านี้
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap shrink-0"
        >
          {open ? "ซ่อน" : "จัดการหน่วยงาน"}
        </button>
      </div>

      {open && (
        <div className="px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาหน่วยงาน เลขสมาชิก หรือชื่อ"
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-full sm:w-80"
            />
            <span className="text-xs text-slate-500">
              {loading ? "กำลังโหลด…" : `${units.length} หน่วยงาน`}
            </span>
          </div>

          {error && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>}
          {notice && <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">{notice}</p>}

          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-semibold">หน่วยงาน</th>
                  <th className="px-3 py-2 font-semibold">สมาชิก</th>
                  <th className="px-3 py-2 font-semibold">ยอดเดือนต่อไป</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {units.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                      {search ? "ไม่พบหน่วยงานที่ค้นหา" : "ยังไม่มีหน่วยงาน"}
                    </td>
                  </tr>
                )}
                {units.map((unit) => {
                  const mode = MODE_TEXT[unit.mode];
                  const isOpen = expanded === unit.id;
                  return (
                    <Fragment key={unit.id}>
                      <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
                        <td className="px-3 py-2">
                          {renaming?.id === unit.id ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <input
                                value={renaming.name}
                                onChange={(e) => setRenaming({ id: unit.id, name: e.target.value })}
                                className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
                                autoFocus
                              />
                              <button
                                onClick={async () => {
                                  const ok = await call(`/api/unit-payers/${unit.id}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ name: renaming.name }),
                                  });
                                  if (ok) setRenaming(null);
                                }}
                                disabled={busy}
                                className="text-xs text-white bg-slate-900 rounded px-2.5 py-1 disabled:opacity-50"
                              >
                                บันทึกชื่อ
                              </button>
                              <button onClick={() => setRenaming(null)} className="text-xs text-slate-500">
                                ยกเลิก
                              </button>
                            </span>
                          ) : (
                            <>
                              <div className="font-medium">{unit.name}</div>
                              <div className="font-mono text-xs text-slate-400">{unit.key}</div>
                              {unit.offices.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {unit.offices.map((o) => (
                                    <span
                                      key={o.name}
                                      className="text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5"
                                      title="ผูกกับหน่วยงานหักเงินในรายชื่อสมาชิกย้ายไปต่างจังหวัด"
                                    >
                                      🗺️ {o.name} · {o.count} คน
                                    </span>
                                  ))}
                                </div>
                              )}
                              {unit.offices.length === 0 && unit.suggestions.length > 0 && (
                                <button
                                  onClick={() => linkOffice(unit, unit.suggestions[0].office)}
                                  disabled={busy}
                                  className="mt-1 text-xs text-violet-700 hover:underline disabled:opacity-50 text-left"
                                  title="สมาชิกที่ระบบจำไว้ของหน่วยงานนี้ อยู่ในหน่วยงานหักเงินนี้ในรายชื่อต่างจังหวัด — กดเพื่อผูกและเพิ่มสมาชิกทั้งหน่วย"
                                >
                                  💡 น่าจะเป็น "{unit.suggestions[0].office}" (สมาชิกตรงกัน {unit.suggestions[0].overlap} จาก{" "}
                                  {unit.suggestions[0].size} คน) — กดเพื่อผูก
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {unit.members.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span>
                              {unit.members.length} คน
                              <span className="block text-xs text-slate-500">
                                {unit.members
                                  .slice(0, 3)
                                  .map((m) => `${m.memberNumber} ${m.name ?? ""}`.trim())
                                  .join(", ")}
                                {unit.members.length > 3 && ` และอีก ${unit.members.length - 3} คน`}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block text-xs border rounded-full px-2 py-0.5 ${mode.className}`}
                            title={mode.title}
                          >
                            {mode.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          <span className="inline-flex gap-3 text-xs">
                            <button
                              onClick={() => {
                                setExpanded(isOpen ? null : unit.id);
                                setAddMember("");
                                setAddAmount("");
                              }}
                              className="text-slate-900 hover:underline"
                            >
                              {isOpen ? "ปิด" : "จัดการสมาชิก"}
                            </button>
                            <button
                              onClick={() => setRenaming({ id: unit.id, name: unit.name })}
                              className="text-slate-600 hover:underline"
                            >
                              แก้ชื่อ
                            </button>
                            <button
                              onClick={() => setPendingDelete(unit)}
                              className="text-red-700 hover:underline"
                            >
                              ลบหน่วยงาน
                            </button>
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50">
                          <td colSpan={4} className="px-4 py-3 space-y-2">
                            {unit.members.length === 0 ? (
                              <p className="text-sm text-slate-400">ยังไม่มีสมาชิกในหน่วยงานนี้</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead className="text-xs text-slate-500 text-left">
                                  <tr>
                                    <th className="py-1 font-semibold">เลขสมาชิก</th>
                                    <th className="py-1 font-semibold">ชื่อ</th>
                                    <th className="py-1 font-semibold text-right">ยอดที่โอนให้ล่าสุด</th>
                                    <th className="py-1" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {unit.members.map((m) => {
                                    const edit = amountEdits[m.id];
                                    return (
                                      <tr key={m.id} className="border-t border-slate-200">
                                        <td className="py-1.5 num">{m.memberNumber}</td>
                                        <td className="py-1.5">
                                          {m.name ?? <span className="text-amber-700">ไม่พบในทะเบียน</span>}
                                          {m.viaOffice && (
                                            <span
                                              className="ml-1.5 text-xs text-violet-700"
                                              title="เพิ่มจากการผูกหน่วยงานหักเงินต่างจังหวัด"
                                            >
                                              🗺️ {m.viaOffice}
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-1.5 text-right">
                                          {edit !== undefined ? (
                                            <span className="inline-flex items-center gap-1.5">
                                              <input
                                                type="number"
                                                inputMode="decimal"
                                                step="0.01"
                                                value={edit}
                                                onChange={(e) =>
                                                  setAmountEdits((prev) => ({ ...prev, [m.id]: e.target.value }))
                                                }
                                                className="border border-slate-300 rounded px-2 py-0.5 text-sm w-24 text-right"
                                              />
                                              <button
                                                onClick={async () => {
                                                  const ok = await call(
                                                    `/api/unit-payers/${unit.id}/members/${m.id}`,
                                                    { method: "PATCH", body: JSON.stringify({ lastAmount: edit }) }
                                                  );
                                                  if (ok)
                                                    setAmountEdits((prev) => {
                                                      const next = { ...prev };
                                                      delete next[m.id];
                                                      return next;
                                                    });
                                                }}
                                                disabled={busy}
                                                className="text-xs text-white bg-slate-900 rounded px-2 py-0.5 disabled:opacity-50"
                                              >
                                                บันทึก
                                              </button>
                                            </span>
                                          ) : (
                                            <button
                                              onClick={() =>
                                                setAmountEdits((prev) => ({
                                                  ...prev,
                                                  [m.id]: m.lastAmount != null ? String(m.lastAmount) : "",
                                                }))
                                              }
                                              className="num hover:underline"
                                              title="แก้ยอด — ใช้เป็นยอดตั้งต้นตอนกด แบ่งให้หลายคน"
                                            >
                                              {m.lastAmount != null ? formatAmount(m.lastAmount) : "—"}
                                            </button>
                                          )}
                                        </td>
                                        <td className="py-1.5 text-right">
                                          <button
                                            onClick={() =>
                                              call(
                                                `/api/unit-payers/${unit.id}/members/${m.id}`,
                                                { method: "DELETE" },
                                                `เอา ${m.memberNumber} ออกจาก ${unit.name} แล้ว`
                                              )
                                            }
                                            disabled={busy}
                                            className="text-xs text-red-700 hover:underline disabled:opacity-40"
                                          >
                                            เอาออก
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                            <div className="border-t border-slate-200 pt-2 space-y-1.5">
                              <p className="text-xs text-slate-500">
                                🗺️ หน่วยงานหักเงินต่างจังหวัด — ผูกแล้วสมาชิกทุกคนของหน่วยงานนั้นในรายชื่อ
                                "สมาชิกย้ายไปต่างจังหวัด" จะถูกเพิ่มเข้าหน่วยงานนี้ และอัปเดตตามเมื่อนำเข้ารายชื่อใหม่
                                (ผูกได้หลายชื่อ ถ้าในไฟล์เขียนชื่อหน่วยต่างกัน)
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {unit.offices.map((o) => (
                                  <span
                                    key={o.name}
                                    className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-full pl-2 pr-1 py-0.5"
                                  >
                                    {o.name} · {o.count} คน
                                    <button
                                      onClick={() => unlinkOffice(unit, o.name)}
                                      disabled={busy}
                                      className="px-1 text-violet-500 hover:text-red-700 disabled:opacity-40"
                                      title="ยกเลิกการผูก"
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ))}
                                {unit.suggestions.map((sg) => (
                                  <button
                                    key={sg.office}
                                    onClick={() => linkOffice(unit, sg.office)}
                                    disabled={busy}
                                    className="text-xs border border-dashed border-violet-300 text-violet-700 rounded-full px-2 py-0.5 hover:bg-violet-50 disabled:opacity-50"
                                    title={`สมาชิกของหน่วยงานนี้ ${sg.overlap} คน อยู่ใน "${sg.office}"`}
                                  >
                                    💡 ผูก {sg.office} ({sg.overlap}/{sg.size})
                                  </button>
                                ))}
                                <select
                                  value={officePick}
                                  onChange={(e) => setOfficePick(e.target.value)}
                                  className="border border-slate-300 rounded px-2 py-1 text-xs max-w-[260px]"
                                >
                                  <option value="">
                                    {officeChoices.length === 0
                                      ? "— ยังไม่มีรายชื่อต่างจังหวัด —"
                                      : "เลือกหน่วยงานหักเงิน…"}
                                  </option>
                                  {officeChoices.map((o) => (
                                    <option key={o.name} value={o.name} disabled={o.linkedTo !== null}>
                                      {o.name} ({o.count} คน){o.linkedTo ? ` — ผูกกับ ${o.linkedTo} แล้ว` : ""}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => linkOffice(unit, officePick)}
                                  disabled={busy || !officePick}
                                  className="text-xs text-white bg-violet-700 rounded px-2.5 py-1 disabled:opacity-50"
                                >
                                  ผูก
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span className="text-xs text-slate-500">เพิ่มสมาชิก</span>
                              <input
                                value={addMember}
                                onChange={(e) => setAddMember(e.target.value)}
                                placeholder="เลขสมาชิก"
                                className="border border-slate-300 rounded px-2 py-1 text-sm w-28"
                              />
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                value={addAmount}
                                onChange={(e) => setAddAmount(e.target.value)}
                                placeholder="ยอด (ถ้ารู้)"
                                className="border border-slate-300 rounded px-2 py-1 text-sm w-28"
                              />
                              <button
                                onClick={() => addToUnit(unit)}
                                disabled={busy || !addMember.trim()}
                                className="text-xs text-white bg-slate-900 rounded px-2.5 py-1.5 disabled:opacity-50"
                              >
                                เพิ่ม
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border border-dashed border-slate-300 rounded px-3 py-2.5 space-y-2">
            <p className="text-xs text-slate-500">
              เพิ่มหน่วยงานล่วงหน้า — วางข้อความรายละเอียดในสเตทเมนต์ของหน่วยงาน เช่น
              "Education Coun/สำนักงานเลขาธิการสภาการศึกษา" (ตัวเลขท้ายข้อความไม่ต้องตรง ระบบไม่นำมาใช้)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="ข้อความรายละเอียดในสเตทเมนต์"
                className="border border-slate-300 rounded px-2 py-1 text-sm w-full sm:w-96"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อที่ใช้เรียก (ไม่ใส่ก็ได้)"
                className="border border-slate-300 rounded px-2 py-1 text-sm w-full sm:w-64"
              />
              <button
                onClick={createUnit}
                disabled={busy || !newDescription.trim()}
                className="text-xs text-white bg-slate-900 rounded px-2.5 py-1.5 disabled:opacity-50"
              >
                เพิ่มหน่วยงาน
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบหน่วยงานนี้?"
        description={
          pendingDelete
            ? `${pendingDelete.name} และรายชื่อสมาชิก ${pendingDelete.members.length} คนของหน่วยงานนี้ — ` +
              "รายการที่บันทึกไปแล้วและยอดที่นับในรอบไม่ถูกแตะต้อง แต่ยอดครั้งต่อไปของหน่วยงานนี้ระบบจะไม่จำแล้ว"
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={async () => {
          const unit = pendingDelete;
          setPendingDelete(null);
          if (unit) await call(`/api/unit-payers/${unit.id}`, { method: "DELETE" }, `ลบ ${unit.name} แล้ว`);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
