import { NextRequest, NextResponse } from "next/server";
import { SplitError, membersForAccounts } from "@/lib/lineSplitStore";

export const dynamic = "force-dynamic";

// The member behind each bank account in a pasted Direct Debit list, so the
// division can be filled from the bank's paper rather than name by name.
// body: { accounts: string[] }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const accounts = (Array.isArray(body.accounts) ? body.accounts : []).map(String).slice(0, 500);
  try {
    return NextResponse.json(await membersForAccounts(params.id, accounts));
  } catch (err) {
    if (err instanceof SplitError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
