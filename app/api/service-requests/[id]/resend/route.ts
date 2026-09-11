import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { allPlanTargets, pushToPlan, resolveForwardPlan } from "@/lib/agent/forwarding";
import { serviceRequestMessages } from "@/lib/serviceRequestMessage";
import { summarisePushFailures } from "@/lib/pushError";
import { departmentNotifyKey, isFeatureEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

// Sends a request to the officer again.
//
// A forward that failed leaves a member's request sitting in this table with
// nobody told about it. The causes are ordinary and all fixable — a stale LINE
// id, an officer who has not added the bot as a friend, a department with
// nobody assigned yet — but until now the only thing the dashboard could do
// about any of them was show the reason. Staff had to ring the officer and
// read the request out, and one member's loan request went nowhere at all.
//
// The second send is built from the logged row (lib/serviceRequestMessage.ts),
// because the conversation it came from is long gone: PendingServiceRequest is
// deleted the moment the first attempt finishes, successful or not. Targets
// are resolved fresh, so a contact staff corrected after the failure is the
// one that gets it.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const entry = await prisma.serviceRequestLog.findUnique({ where: { id: params.id } });
  if (!entry) {
    return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });
  }

  // A request that reached its officer is not resent from here. Sending it
  // twice would read as the member asking twice, and this button exists for
  // the ones nobody received.
  if (entry.status === "forwarded") {
    return NextResponse.json(
      { error: "คำขอนี้ส่งต่อสำเร็จแล้ว ไม่ต้องส่งซ้ำ" },
      { status: 400 }
    );
  }

  // The mute is a deliberate setting made by staff in ตั้งค่าระบบ; a button in
  // another tab must not quietly override it. Say which switch to turn back on
  // instead.
  if (
    entry.department &&
    !(await isFeatureEnabled(departmentNotifyKey(entry.department)))
  ) {
    return NextResponse.json(
      {
        error: `แผนก "${entry.department}" ปิดแจ้งเตือนอยู่ — เปิดที่แท็บ "ตั้งค่าระบบ" ก่อนแล้วค่อยส่งซ้ำ`,
      },
      { status: 409 }
    );
  }

  const plan = await resolveForwardPlan(entry.lineUserId, entry.department);
  const targets = allPlanTargets(plan);
  if (targets.length === 0) {
    // Recorded as well as reported: the row should say what staff would see if
    // they looked at it again, not what it said before this attempt.
    await prisma.serviceRequestLog
      .update({
        where: { id: entry.id },
        data: {
          status: "unconfigured",
          forwardError: "ยังไม่มีผู้รับของแผนกนี้",
          resentAt: new Date(),
        },
      })
      .catch(() => {});
    return NextResponse.json(
      {
        error: `ยังไม่มีผู้รับของแผนก "${entry.department ?? "-"}" — ตั้งค่าผู้รับที่แท็บ "แผนก/ผู้รับผิดชอบ" ก่อน`,
      },
      { status: 409 }
    );
  }

  const messages = serviceRequestMessages(
    {
      documentType: entry.documentType,
      department: entry.department,
      requestType: entry.requestType,
      memberFullName: entry.memberFullName,
      memberNumber: entry.memberNumber,
      phone: entry.phone,
      memberVerified: entry.memberVerified,
    },
    entry.imageUrl,
    entry.imageIsPdf,
    // The date the member actually asked, so a request sent on a week's delay
    // is not read as one made today.
    entry.createdAt
  );

  const { succeededIds, failedIds, errors } = await pushToPlan(
    plan,
    messages,
    "resend service request"
  );

  if (succeededIds.length === 0) {
    const reason = summarisePushFailures(errors);
    await prisma.serviceRequestLog
      .update({
        where: { id: entry.id },
        data: {
          status: "failed",
          forwardedTo: targets.join(", "),
          forwardError: reason,
          resentAt: new Date(),
        },
      })
      .catch(() => {});
    return NextResponse.json(
      { error: `ส่งซ้ำไม่สำเร็จ: ${reason ?? "ไม่ทราบสาเหตุ"}` },
      { status: 502 }
    );
  }

  // Same shape the first attempt writes: who got it, and who did not.
  const forwardedTo =
    failedIds.length > 0
      ? `${succeededIds.join(", ")} (failed: ${failedIds.join(", ")})`
      : succeededIds.join(", ");
  const updated = await prisma.serviceRequestLog.update({
    where: { id: entry.id },
    data: {
      status: "forwarded",
      forwardedTo,
      // The old reason is not left behind on a row that now reads
      // "ส่งต่อสำเร็จ" — a failure that has been put right should stop being
      // reported as one.
      forwardError: null,
      resentAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, entry: updated, sentTo: succeededIds.length });
}
