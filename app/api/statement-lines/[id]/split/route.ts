import { NextRequest, NextResponse } from "next/server";
import { SplitError, applySplit, splitContext, undoSplit } from "@/lib/lineSplitStore";

export const dynamic = "force-dynamic";

// Dividing one bank line among several members — a unit's payroll office
// paying for its people in a single transfer. See lib/unitPayer.ts and
// lib/lineSplitStore.ts.

const fail = (err: unknown) => {
  if (err instanceof SplitError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
};

// What the dialog opens with: the payer if it is known, the members it paid
// for last time, any split already made, and the round the shares would go to.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await splitContext(params.id));
  } catch (err) {
    return fail(err);
  }
}

// body: { payerName, parts: [{ memberNumber, amount }] }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const parts = (Array.isArray(body.parts) ? body.parts : []).map(
    (p: { memberNumber?: unknown; amount?: unknown }) => ({
      memberNumber: String(p?.memberNumber ?? "").trim(),
      amount: Number(p?.amount),
    })
  );
  try {
    return NextResponse.json({ ok: true, ...(await applySplit(params.id, String(body.payerName ?? ""), parts)) });
  } catch (err) {
    return fail(err);
  }
}

// Takes the division back: the shares leave the round and the ธุรกรรม tab.
// The payer and the members remembered for it stay.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await undoSplit(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
