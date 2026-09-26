import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchSlipHints } from "@/lib/statementSlipHints";
import { countedElsewhere } from "@/lib/roundDoubleCount";
import { recordedOwnersForAccounts } from "@/lib/roundRecordings";
import { splitByBinding } from "@/lib/boundTransfers";
import { ROUND_CLOSED_ERROR, countedAmount } from "@/lib/carriedDebt";
import { splitOriginsFor } from "@/lib/lineSplitStore";
import { isSetAsidePiece } from "@/lib/transferSetAside";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";
import { unbridgedRecordings } from "@/lib/unbridgedRecordings";
import { summarizeStatementFiles } from "@/lib/roundStatementFiles";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const [members, transfers] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId: round.id },
      orderBy: [{ unitName: "asc" }, { memberNumber: "asc" }],
    }),
    // Every transfer, not just the unmatched ones: staff need to reach an
    // individual payment to say "this was ซื้อหุ้น, not a deduction", and the
    // dangerous case is precisely one that did match a member.
    prisma.statementTransfer.findMany({
      where: { roundId: round.id },
      orderBy: { transferredAt: "desc" },
    }),
  ]);

  // A line whose whole amount went to a carried debt has been placed, just
  // not in this round — it is no longer anyone's work here.
  const unmatchedRows = transfers.filter(
    (t) => !t.memberNumber && !t.excludedReason && countedAmount(t) > 0.01
  );

  // Whether the daily page has already been told whose these are. Staff ring
  // round and record the payment there; the round has no way to hear about it
  // and goes on listing the account as unknown — see lib/recordedOwners.ts.
  const unknownAccounts = [...new Set(unmatchedRows.map((t) => t.accountNumber))];
  const recordedOwners = await recordedOwnersForAccounts(unknownAccounts);

  // Which of these accounts staff have already bound to a member. A binding
  // to somebody on this round's list would have matched the transfer, so
  // every one found here names a member the round has no row for — see
  // lib/boundTransfers.ts for why they must not stay under "ไม่พบเจ้าของ".
  const bindings = unknownAccounts.length
    ? await prisma.memberBankAccount.findMany({
        where: { accountNumber: { in: unknownAccounts } },
        select: { accountNumber: true, memberNumber: true, memberName: true },
      })
    : [];
  // A bound member number that is in no list at all is the shape of a typo,
  // and stays on the list of work rather than being taken as knowledge.
  const boundRoster = bindings.length
    ? await prisma.memberRoster.findMany({
        where: { memberNumber: { in: [...new Set(bindings.map((b) => b.memberNumber))] } },
        select: { memberNumber: true },
      })
    : [];
  const inRoster = new Set(boundRoster.map((m) => m.memberNumber));
  const onRoundNumbers = new Set(members.map((m) => m.memberNumber));

  const { unknown, outsideRound } = splitByBinding(
    unmatchedRows.map((t) => ({
      ...t,
      recordedAs: recordedOwners.get(t.accountNumber) ?? null,
    })),
    new Map(
      bindings.map((row) => [
        row.accountNumber,
        {
          memberNumber: row.memberNumber,
          memberName: row.memberName,
          inRoster: inRoster.has(row.memberNumber) || onRoundNumbers.has(row.memberNumber),
        },
      ])
    )
  );
  const unmatched = unknown;

  // Every account the cooperative knows a member by: the one this round's
  // sheet gives, and every one the directory holds for them. A member with
  // no account number of their own is not necessarily somebody nobody has an
  // account for — where the directory knows more than one, the fill refuses
  // to choose (lib/accountHistory.ts) and the column stays blank. And one
  // whose sheet does give an account may well pay from another; staff asked
  // to see everyone with more than one, not only the blanks.
  //
  // Chunked, because a round seeded from the รายการหัก runs to thousands of
  // members.
  const allNumbers = members.map((m) => m.memberNumber);
  const CHUNK = 1000;
  const directoryOf = new Map<string, string[]>();
  for (let i = 0; i < allNumbers.length; i += CHUNK) {
    const found = await prisma.memberBankAccount.findMany({
      where: { memberNumber: { in: allNumbers.slice(i, i + CHUNK) } },
      select: { memberNumber: true, accountNumber: true },
    });
    for (const entry of found) {
      directoryOf.set(entry.memberNumber, [
        ...(directoryOf.get(entry.memberNumber) ?? []),
        entry.accountNumber,
      ]);
    }
  }
  const membersWithAccounts = members.map((member) => ({
    ...member,
    knownAccounts: [
      ...new Set([
        ...(member.accountNumber ? [member.accountNumber] : []),
        ...(directoryOf.get(member.memberNumber) ?? []),
      ]),
    ].sort(),
  }));

  // Still-owing first, then overpaid, then settled: a round runs to hundreds
  // of members and the ones staff opened this tab to chase should not be
  // below a screenful of people who already paid. Sorted here rather than in
  // the query because the ordering is by meaning, not alphabetical — "unpaid"
  // sorts last as a string.
  const STATUS_ORDER: Record<string, number> = { unpaid: 0, overpaid: 1, paid: 2 };
  membersWithAccounts.sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0)
  );

  const totals = members.reduce(
    (acc, m) => {
      acc.due += m.amountDue;
      acc.paid += m.amountPaid;
      return acc;
    },
    { due: 0, paid: 0 }
  );

  // Which statements this round was built from. Uploads accumulate, so
  // without this the only sign a file had been loaded was the totals moving,
  // and staff had no way to tell whether they had already dropped in the
  // second half of the month. Cash entries excluded: "account: cash" was
  // never a file, and belongs beside the transfers it sits among (see the
  // 💵 tag on the row itself), not in a list of Statement uploads.
  const loaded = summarizeStatementFiles(transfers);

  // Which of these transfers look like they were for something other than a
  // deduction, judged against the slips members filed through the bot.
  const memberNumbers = [...new Set(transfers.map((t) => t.memberNumber).filter(Boolean))] as string[];
  const slips =
    memberNumbers.length > 0
      ? await prisma.expense.findMany({
          where: { memberNumber: { in: memberNumbers } },
          select: { memberNumber: true, amount: true, date: true, category: true },
        })
      : [];
  const hints = matchSlipHints(
    transfers.map((t) => ({
      id: t.id,
      memberNumber: t.memberNumber,
      amount: t.amount,
      transferredAt: t.transferredAt,
    })),
    slips.map((s) => ({
      memberNumber: s.memberNumber as string,
      amount: s.amount,
      date: s.date,
      category: s.category,
    }))
  );

  // The same bank line counting in another round as well. Loading one export
  // into two rounds is the obvious thing to do — September's file into August
  // for the late payers and into September for the current month — and it
  // marks everyone who paid once as having settled both. See
  // lib/roundDoubleCount.ts.
  const counts = (t: { memberNumber: string | null; excludedReason: string | null }) =>
    t.memberNumber !== null && t.excludedReason === null;
  const twins = await prisma.statementTransfer.findMany({
    where: {
      fingerprint: { in: transfers.map((t) => t.fingerprint) },
      roundId: { not: round.id },
    },
    select: { fingerprint: true, roundId: true, memberNumber: true, excludedReason: true },
  });
  const otherRounds = twins.length
    ? await prisma.statementRound.findMany({
        where: { id: { in: [...new Set(twins.map((t) => t.roundId))] } },
        select: { id: true, label: true },
      })
    : [];
  const labelByRound = new Map(otherRounds.map((r) => [r.id, r.label]));
  const doubles = countedElsewhere(
    transfers.map((t) => ({ id: t.id, fingerprint: t.fingerprint, counts: counts(t) })),
    twins.map((t) => ({
      fingerprint: t.fingerprint,
      label: labelByRound.get(t.roundId) ?? t.roundId,
      counts: counts(t),
    }))
  );

  // Which unit a share came from, on rows that are only part of a bank line.
  const origins = await splitOriginsFor(round.id, transfers);

  const withHints = transfers.map((t) => ({
    id: t.id,
    memberNumber: t.memberNumber,
    accountNumber: t.accountNumber,
    amount: t.amount,
    transferredAt: t.transferredAt,
    branch: t.branch,
    description: t.description,
    excludedReason: t.excludedReason,
    manualMemberNumber: t.manualMemberNumber,
    carriedAmount: t.carriedAmount,
    slipHint: hints.get(t.id) ?? null,
    // Empty on all but the few lines being counted more than once.
    alsoCountedIn: doubles.get(t.id) ?? [],
    splitFrom: origins.get(t.id) ?? null,
    // The part staff cut out of another row ("ตัดยอดออก"), which can be put back.
    setAside: isSetAsidePiece(t.fingerprint),
  }));

  const excluded = withHints.filter((t) => t.excludedReason);

  // Money filed on the เงินเข้าประจำวัน page as this month's deduction that the
  // round never took in — see lib/unbridgedRecordings.ts. Shown, not counted.
  const roundNumberByKey = new Map<string, string>();
  for (const m of members) {
    const key = memberNumberKey(m.memberNumber);
    if (key) roundNumberByKey.set(key, m.memberNumber);
  }
  const memberKeys = [...roundNumberByKey.keys()];
  const recordings: { id: string; memberNumber: string | null; amount: number; createdAt: Date; statementLineId: string | null }[] = [];
  for (let i = 0; i < memberKeys.length; i += CHUNK) {
    recordings.push(
      ...(await prisma.expense.findMany({
        where: {
          category: DEDUCTION_CATEGORY,
          statementLineId: { not: null },
          memberNumber: { in: memberKeys.slice(i, i + CHUNK) },
        },
        select: { id: true, memberNumber: true, amount: true, createdAt: true, statementLineId: true },
      }))
    );
  }
  const recordedLines = recordings.length
    ? await prisma.statementLine.findMany({
        where: { id: { in: recordings.map((r) => r.statementLineId as string) } },
        select: { id: true, postedAt: true, fingerprint: true, senderAccount: true },
      })
    : [];
  const lineById = new Map(recordedLines.map((l) => [l.id, l]));
  const recordedOutside = unbridgedRecordings(
    recordings.flatMap((r) => {
      const line = lineById.get(r.statementLineId as string);
      const memberNumber = roundNumberByKey.get(memberNumberKey(r.memberNumber) ?? "");
      if (!line || !memberNumber) return [];
      // The same month rule the record route bridges by: a payment belongs to
      // the round whose period its own bank date falls in.
      if (periodOfDate(line.postedAt ?? r.createdAt) !== round.period) return [];
      return [
        {
          expenseId: r.id,
          memberNumber,
          amount: r.amount,
          postedAt: line.postedAt,
          createdAt: r.createdAt,
          lineFingerprint: line.fingerprint,
          senderAccount: line.senderAccount,
        },
      ];
    }),
    transfers.map((t) => ({
      fingerprint: t.fingerprint,
      accountNumber: t.accountNumber,
      amount: t.amount,
      transferredAt: t.transferredAt,
    }))
  );

  return NextResponse.json({
    round,
    data: membersWithAccounts,
    unmatched,
    // Money whose owner staff have already written down, kept apart from the
    // money nobody has placed: the list of work has to shrink as the work is
    // done, or pressing บันทึก reads as having done nothing.
    outsideRound,
    outsideRoundTotal:
      Math.round(outsideRound.reduce((sum, t) => sum + countedAmount(t), 0) * 100) / 100,
    transfers: withHints,
    recordedOutside,
    excluded,
    excludedTotal:
      Math.round(excluded.reduce((sum, t) => sum + t.amount, 0) * 100) / 100,
    statements: loaded,
    totals: {
      ...totals,
      outstanding: Math.round((totals.due - totals.paid) * 100) / 100,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // A closed round is where its carried debts came from; deleting it would
  // leave them, and any payments toward them, pointing at nothing.
  const round = await prisma.statementRound.findUnique({
    where: { id: params.id },
    select: { closedAt: true },
  });
  if (round?.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }
  // Nor an open round some of whose money pays a carried debt: the payment
  // finds its bank line by this round's id, and a round created again from
  // the same statement would count that money a second time.
  const carriedFromHere = await prisma.carriedDebtPayment.count({
    where: { roundId: params.id },
  });
  if (carriedFromHere > 0) {
    return NextResponse.json(
      {
        error:
          `ลบรอบนี้ไม่ได้ — มียอดจากรอบนี้ ${carriedFromHere} รายการที่ย้ายไปชำระข้ามเดือนแล้ว ` +
          `ต้องลบรายการชำระเหล่านั้นที่แถบ "ชำระข้ามเดือน" ก่อน`,
      },
      { status: 409 }
    );
  }

  // The member and transfer rows are this round's working data, not history
  // worth keeping on its own — both are rebuilt by re-uploading the two
  // sheets, so they go with the round rather than being orphaned.
  await prisma.$transaction([
    prisma.statementMember.deleteMany({ where: { roundId: params.id } }),
    prisma.statementTransfer.deleteMany({ where: { roundId: params.id } }),
    prisma.statementRound.deleteMany({ where: { id: params.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
