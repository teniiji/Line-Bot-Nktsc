import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAccountNumber } from "@/lib/statementReconcile";
import { memberNumberKey } from "@/lib/memberNumber";
import { agreedBindings, type ProposedBinding } from "@/lib/bulkBinding";
import { recordedOwnersForAccounts } from "@/lib/roundRecordings";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Takes, in one go, the answers the daily page already has.
//
// Every one of these bindings can be made by hand on its own row — this is
// the same action, repeated, for a person who has just read the list and
// agreed with all of it. What it must not become is a button that binds
// accounts nobody looked at, so the browser sends back the pairs it showed
// and only those the database still agrees with are written. See
// lib/bulkBinding.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const body = await request.json();
  const proposed: ProposedBinding[] = Array.isArray(body.bindings)
    ? body.bindings
        .map((row: { accountNumber?: unknown; memberNumber?: unknown }) => ({
          accountNumber: normalizeAccountNumber(row.accountNumber) ?? "",
          memberNumber: memberNumberKey(String(row.memberNumber ?? "")) ?? "",
        }))
        .filter((row: ProposedBinding) => row.accountNumber && row.memberNumber)
    : [];
  if (proposed.length === 0) {
    return NextResponse.json({ error: "ไม่มีรายการให้ผูก" }, { status: 400 });
  }

  // The same question the round's own view asked, asked again here: what does
  // the daily page say about the accounts this round still cannot place?
  const transfers = await prisma.statementTransfer.findMany({
    where: { roundId: round.id, memberNumber: null, excludedReason: null },
    select: { accountNumber: true },
  });
  const unknownAccounts = [...new Set(transfers.map((t) => t.accountNumber))];
  const recorded = await recordedOwnersForAccounts(unknownAccounts);

  const { apply, stale } = agreedBindings(
    proposed,
    new Map([...recorded].map(([account, owner]) => [account, owner.memberNumber]))
  );

  // Written one by one rather than in a createMany: each is an upsert on a
  // unique account, and the directory may already carry a binding for it that
  // this is correcting.
  for (const pair of apply) {
    const memberName = recorded.get(pair.accountNumber)?.memberName ?? null;
    await prisma.memberBankAccount.upsert({
      where: { accountNumber: pair.accountNumber },
      create: { ...pair, memberName },
      update: { memberNumber: pair.memberNumber, memberName },
    });
  }

  // Once for the whole batch. The single-row route re-reconciles the round on
  // every save, which is right for one row and would be hundreds of full
  // passes over the round here.
  if (apply.length > 0) {
    await applyDirectoryAccounts(round.id);
    await rematchRoundTransfers(round.id);
    await recomputeRoundPayments(round.id);
  }

  // What the person will see when the page redraws, said in numbers: how many
  // of these the round could actually count, and how many are members it has
  // no row for. Both are worth knowing before scrolling.
  const onRound = await prisma.statementMember.findMany({
    where: { roundId: round.id, memberNumber: { in: apply.map((p) => p.memberNumber) } },
    select: { memberNumber: true },
  });
  const counted = new Set(onRound.map((m) => m.memberNumber));

  return NextResponse.json({
    applied: apply.length,
    matched: apply.filter((p) => counted.has(p.memberNumber)).length,
    outsideRound: apply.filter((p) => !counted.has(p.memberNumber)).length,
    // Shown to the person but no longer true when they pressed the button —
    // somebody recorded a different member in between, or withdrew it.
    stale: stale.length,
  });
}
