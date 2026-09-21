"use client";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // What is about to happen, item by item, for a question that cannot be
  // asked in a sentence: "ผูก 37 บัญชีนี้ไหม" is only answerable by somebody
  // who can see the 37.
  children?: React.ReactNode;
  // Red is for the ones that destroy something. A batch of the same save
  // staff make by hand all day should not be dressed as a demolition.
  tone?: "danger" | "neutral";
  // A third way out, for a question whose honest answer is usually neither
  // "yes" nor "no" — "เพิ่มเข้าไป" beside "แทนที่ทั้งรอบ" and "ยกเลิก". It
  // leads, because a dialog offering only a demolition and a retreat gets
  // the demolition pressed by people who wanted neither.
  alternateLabel?: string;
  onAlternate?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  children,
  tone = "danger",
  alternateLabel,
  onAlternate,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg p-5 max-w-lg w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg">{title}</h3>
        {description && (
          <p className="text-sm text-slate-600 whitespace-pre-line">{description}</p>
        )}
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-slate-300 rounded px-4 py-2 text-sm font-medium"
          >
            {cancelLabel}
          </button>
          {alternateLabel && onAlternate && (
            <button
              type="button"
              onClick={onAlternate}
              className="rounded px-4 py-2 text-sm font-medium text-white bg-slate-900"
            >
              {alternateLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded px-4 py-2 text-sm font-medium text-white ${
              tone === "danger" ? "bg-red-600" : "bg-slate-900"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
