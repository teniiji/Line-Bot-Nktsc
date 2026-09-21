"use client";

import { formatAmount } from "@/lib/format";
import { SHEET_FIELDS, type SheetField, type SheetMapping } from "@/lib/sheetColumns";

export interface SheetPreview {
  // Every page in the workbook, and which one this reading came from. A
  // unit's file carries "หน่วย" beside "สรุป" and sometimes a third with the
  // results on it — reading page one and finding no amounts looked like a
  // broken file rather than the wrong page of a good one.
  sheets: { index: number; name: string; rows: number }[];
  sheetIndex: number;
  headerRow: number | null;
  firstDataRow: number;
  mapping: SheetMapping;
  fromHeader: boolean;
  columns: { index: number; letter: string; header: string | null; samples: string[] }[];
  totalRows: number;
  counts: {
    members: number;
    skipped: number;
    awaiting: number;
    collected: number;
    uncollected: number;
    uncollectedAmount: number;
  };
  preview: {
    memberNumber: string;
    name: string;
    unitName: string | null;
    unitCode?: string | null;
    hCode: string | null;
    expectedAmount: number | null;
    amountDue: number;
    result: string;
  }[];
}

const RESULT_LABEL: Record<string, string> = {
  awaiting: "⏳ รอผลการหัก",
  collected: "✅ หักได้ครบ",
  uncollected: "หักไม่ได้",
};

// What the system made of an uploaded sheet, before any of it is saved.
//
// Every เขต builds its own file: one has two banner rows, a header and a
// ลำดับ column in front of the member number; another has no header at all.
// Read by position, the second kind put ยอดหักได้ into ยอดหักไม่ได้ and
// imported a district that had paid in full as owing ฿12,243,006, and nothing
// on screen said so until somebody read the table and found ลำดับ numbers in
// the เลขสมาชิก column.
//
// So the reading is shown as a reading: which column became which field, the
// first rows as they would be saved, and the totals to check against the
// unit's own summary. Correct it here or send the file back.
export default function SheetMappingDialog({
  open,
  fileName,
  preview,
  mapping,
  onChange,
  onPickSheet,
  onConfirm,
  onCancel,
  busy,
  confirmLabel,
}: {
  open: boolean;
  fileName: string;
  preview: SheetPreview | null;
  mapping: SheetMapping;
  onChange: (mapping: SheetMapping) => void;
  onPickSheet: (sheetIndex: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  confirmLabel: string;
}) {
  if (!open || !preview) return null;

  const pick = (field: SheetField, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    onChange(next);
  };

  const ready = mapping.memberNumber !== undefined;
  const { counts } = preview;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 z-50 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg p-5 max-w-3xl w-full space-y-4 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-semibold text-lg">ตรวจการอ่านไฟล์ก่อนนำเข้า</h3>
          {/* Offered whenever the workbook has more than one page, because
              which page holds the results is not something the file says. */}
          {preview.sheets.length > 1 && (
            <label className="text-sm flex items-center gap-2 mt-2">
              <span className="text-slate-600">ชีตในไฟล์</span>
              <select
                value={preview.sheetIndex}
                onChange={(e) => onPickSheet(Number(e.target.value))}
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white"
              >
                {preview.sheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.name} ({sheet.rows} แถว)
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-mono text-xs">{fileName}</span> ·{" "}
            {preview.fromHeader ? (
              <>
                อ่านหัวตารางที่แถว <strong className="num">{preview.headerRow! + 1}</strong> ได้
                — ตรวจอีกครั้งว่าตรงไหม
              </>
            ) : (
              <>
                ไฟล์นี้<strong>ไม่มีแถวหัวตาราง</strong> ระบบเดาจากข้อมูลในคอลัมน์ —{" "}
                <strong>ช่องยอดเงินต้องเลือกเอง</strong> เพราะเดาผิดแล้วยอดค้างจะเพี้ยนทั้งรอบ
              </>
            )}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {SHEET_FIELDS.map(({ field, label, required }) => (
            <label key={field} className="text-sm flex items-center gap-2">
              <span className="w-24 shrink-0 text-slate-600">
                {label}
                {required && <span className="text-red-600"> *</span>}
              </span>
              <select
                value={mapping[field] ?? ""}
                onChange={(e) => pick(field, e.target.value)}
                className={`flex-1 min-w-0 border rounded px-2 py-1 text-sm bg-white ${
                  required && mapping[field] === undefined
                    ? "border-red-300"
                    : "border-slate-300"
                }`}
              >
                <option value="">— ไม่มีในไฟล์นี้ —</option>
                {preview.columns.map((column) => (
                  <option key={column.index} value={column.index}>
                    {column.letter}
                    {column.header ? ` · ${column.header}` : ""}
                    {column.samples.length > 0 ? ` (${column.samples[0].slice(0, 18)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div>
          <p className="text-xs text-slate-500 mb-1">
            อ่านได้ <strong className="num">{counts.members}</strong> คนจาก{" "}
            <strong className="num">{preview.totalRows}</strong> แถว
            {counts.skipped > 0 && (
              <>
                {" "}
                · ข้าม <strong className="num">{counts.skipped}</strong> แถวที่ไม่มีเลขสมาชิก
              </>
            )}{" "}
            · รอผล <strong className="num">{counts.awaiting}</strong> · หักได้ครบ{" "}
            <strong className="num">{counts.collected}</strong> · หักไม่ได้{" "}
            <strong className="num">{counts.uncollected}</strong> คน{" "}
            <strong className="num">{formatAmount(counts.uncollectedAmount)}</strong>
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left text-xs">
                <tr>
                  <th className="px-2 py-1.5 font-medium">เลขสมาชิก</th>
                  <th className="px-2 py-1.5 font-medium">ชื่อ-สกุล</th>
                  <th className="px-2 py-1.5 font-medium">หน่วยคุม · สังกัด</th>
                  <th className="px-2 py-1.5 font-medium text-right">แจ้งหัก</th>
                  <th className="px-2 py-1.5 font-medium text-right">หักไม่ได้</th>
                  <th className="px-2 py-1.5 font-medium">จะบันทึกเป็น</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row, index) => (
                  <tr key={`${row.memberNumber}-${index}`} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 num">{row.memberNumber}</td>
                    <td className="px-2 py-1.5">{row.name || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {row.hCode && <span className="num text-xs text-slate-400">{row.hCode} </span>}
                      {row.unitName ?? "—"}
                      {row.unitCode && (
                        <span className="num text-xs text-slate-400"> · {row.unitCode}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 num text-right text-slate-500">
                      {row.expectedAmount != null ? formatAmount(row.expectedAmount) : "—"}
                    </td>
                    <td className="px-2 py-1.5 num text-right">
                      {row.amountDue > 0 ? formatAmount(row.amountDue) : "—"}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">
                      {RESULT_LABEL[row.result] ?? row.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            เทียบตัวเลขข้างบนกับใบสรุปของหน่วยก่อนกดยืนยัน — ถ้าไม่ตรง แก้ช่องด้านบนแล้วดูใหม่
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="border border-slate-300 rounded px-4 py-2 text-sm font-medium"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!ready || busy}
            title={ready ? undefined : "ต้องเลือกคอลัมน์เลขสมาชิกก่อน"}
            className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
