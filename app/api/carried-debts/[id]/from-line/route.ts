import { NextRequest, NextResponse } from "next/server";
import { DebtPaymentError, payDebtFromLine } from "@/lib/carriedDebtFromLine";

export const dynamic = "force-dynamic";

// Pays a carried debt from a bank line on the เงินเข้าประจำวัน page that no
// round holds — see lib/carriedDebtFromLine.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const paid = await payDebtFromLine(
      params.id,
      String(body.lineId ?? ""),
      body.amount === undefined || body.amount === "" ? undefined : Number(body.amount)
    );
    return NextResponse.json({ ok: true, debtId: paid.debtId, amount: paid.amount });
  } catch (err) {
    if (err instanceof DebtPaymentError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
