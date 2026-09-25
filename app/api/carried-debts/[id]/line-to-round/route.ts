import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_FINGERPRINT_PREFIX } from "@/lib/carriedDebt";
import { periodOfDate } from "@/lib/deductionPeriod";
import { memberNumberKey } from "@/lib/memberNumber";
import { isMemberDeposit } from "@/lib/statementLines";
import { coveredByRealTransfer } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { transferSourceKey } from "@/lib/carriedDebtCandidatesStore";

export const dynamic = "force-dynamic";

// "นับเป็นยอดของเดือนที่โอน": the other answer to a daily line the statement
// check offered for a carried debt — this money is the month it arrived in,
// not the old debt. The 29755 case: a unit paying a moved member's September
// deduction by transfer (BSD02, no paying account), which no round could
// ever receive from a file, so the member sat on ⏳ รอผลการหัก with the money
// already in the bank.
//
// Writes the line into the open round for its own month under the debt's
// member, exactly as the daily page's bridge would (fingerprint "line:…",
// manualMemberNumber), and hides it from this debt's suggestions.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const debt = await prisma.carriedDebt.findUnique({ where: { id: params.id } });
  if (!debt) {
    return NextResponse.json({ error: "ไม่พบหนี้รายการนี้" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const line = await prisma.statementLine.findUnique({ where: { id: String(body.lineId ?? "") } });
  if (!line || !isMemberDeposit(line.channel) || line.amount <= 0 || !line.postedAt) {
    return NextResponse.json({ error: "ไม่พบรายการเงินเข้านี้" }, { status: 404 });
  }
  const lineKey = `${LINE_FINGERPRINT_PREFIX}${line.fingerprint}`;

  // Money already put toward a carried debt is not this month's to count.
  const used = await prisma.carriedDebtPayment.count({ where: { fingerprint: lineKey } });
  if (used > 0) {
    return NextResponse.json(
      { error: "ยอดนี้ใช้ชำระหนี้ข้ามเดือนไปแล้ว — ลบรายการชำระนั้นที่แถบนี้ก่อน" },
      { status: 409 }
    );
  }

  const round = await prisma.statementRound.findUnique({
    where: { period: periodOfDate(line.postedAt) },
    select: { id: true, label: true, closedAt: true },
  });
  if (!round || round.closedAt) {
    return NextResponse.json(
      { error: "ไม่มีรอบที่เปิดอยู่ของเดือนที่เงินเข้า" },
      { status: 409 }
    );
  }
  const key = memberNumberKey(debt.memberNumber);
  const member = (
    await prisma.statementMember.findMany({
      where: { roundId: round.id },
      select: { memberNumber: true },
    })
  ).find((m) => memberNumberKey(m.memberNumber) === key);
  if (!member) {
    return NextResponse.json(
      { error: `เลขสมาชิก ${debt.memberNumber} ไม่อยู่ในรอบ ${round.label}` },
      { status: 409 }
    );
  }

  // The line may already be in the round — bridged earlier, or read from a
  // file. Then it is that row that has to count for this member: skipping
  // it because "the round already has it" left the money sitting under
  // somebody else, or set aside as ไม่เกี่ยวกับรอบนี้, while the member stayed
  // on ⏳ รอผลการหัก and the button said it had worked.
  const inRound = await prisma.statementTransfer.findMany({
    where: {
      roundId: round.id,
      OR: [
        { fingerprint: lineKey },
        ...(line.senderAccount ? [{ accountNumber: line.senderAccount, amount: line.amount }] : []),
      ],
    },
    select: {
      id: true,
      fingerprint: true,
      accountNumber: true,
      amount: true,
      transferredAt: true,
      memberNumber: true,
      excludedReason: true,
      carriedAmount: true,
    },
  });
  const held = inRound.find(
    (t) =>
      t.fingerprint === lineKey ||
      (line.senderAccount !== null &&
        coveredByRealTransfer([t], line.senderAccount, line.amount, line.postedAt as Date))
  );

  let action: "created" | "reassigned" | "already";
  if (!held) {
    await prisma.statementTransfer.create({
      data: {
        roundId: round.id,
        memberNumber: member.memberNumber,
        accountNumber: line.senderAccount ?? "",
        amount: line.amount,
        transferredAt: line.postedAt,
        account: line.account,
        branch: line.branch,
        description: line.description,
        fingerprint: lineKey,
        sourceFile: line.sourceFile,
        manualMemberNumber: true,
      },
    });
    action = "created";
  } else if (held.carriedAmount > 0.01) {
    return NextResponse.json(
      {
        error:
          "ยอดนี้ในรอบถูกย้ายไปชำระหนี้ข้ามเดือนบางส่วนแล้ว — ลบรายการชำระนั้นที่แถบนี้ก่อน",
      },
      { status: 409 }
    );
  } else if (held.memberNumber !== member.memberNumber || held.excludedReason !== null) {
    await prisma.statementTransfer.update({
      where: { id: held.id },
      data: { memberNumber: member.memberNumber, manualMemberNumber: true, excludedReason: null },
    });
    action = "reassigned";
  } else {
    action = "already";
  }
  await recomputeRoundPayments(round.id);

  // Hidden both as the daily line it was and as the round row it now is.
  for (const sourceKey of [lineKey, transferSourceKey(round.id, lineKey)]) {
    await prisma.carriedDebtDismissal.upsert({
      where: { debtId_sourceKey: { debtId: debt.id, sourceKey } },
      create: { debtId: debt.id, sourceKey },
      update: {},
    });
  }

  // What the round now says about the member, so the page can show the
  // result rather than a bare "done".
  const after = await prisma.statementMember.findFirst({
    where: { roundId: round.id, memberNumber: member.memberNumber },
    select: { amountPaid: true, status: true },
  });

  return NextResponse.json({
    ok: true,
    roundLabel: round.label,
    action,
    amountPaid: after?.amountPaid ?? 0,
    status: after?.status ?? null,
  });
}
