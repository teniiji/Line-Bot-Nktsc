// Clears MemberRoster.lineUserId for every member, so each one re-binds to
// whatever LINE account they next identify from.
//
// Run this after EVERY move to a new LINE Official Account. A LINE userId is
// scoped to the OA channel that issued it, so moving channels silently
// invalidates every stored id at once. The stale value doesn't just stop
// helping — submitMemberInfo's impersonation guard (lib/agent/identityHandlers.ts)
// sees a member number bound to a LINE account that isn't the one messaging
// and refuses to record their transaction, with no way for the member to
// recover on their own.
//
// This exists as a script rather than another migration because it is a
// recurring operational task, not a one-time schema change: a migration runs
// once ever under its own name, so each OA move would need a brand new
// migration file (the first move already needed
// 20260728120000_clear_stale_line_links). Staff can also unlink a single
// member from the dashboard — แท็บ "สมาชิก LINE" > คอลัมน์ "เชื่อมต่อ LINE" >
// "ปลด" — which is the right tool for one person who changed phones; this
// script is for the whole-roster case where that would take all day.
//
// Dry run by default. Pass --yes to actually write.
//
// Usage:
//   npx tsx scripts/clear-line-links.ts          # show what would change
//   npx tsx scripts/clear-line-links.ts --yes    # actually clear

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const confirmed = process.argv.includes("--yes");

  const [total, bound] = await Promise.all([
    prisma.memberRoster.count(),
    prisma.memberRoster.count({ where: { lineUserId: { not: null } } }),
  ]);

  console.log(`สมาชิกในทะเบียนทั้งหมด: ${total}`);
  console.log(`ผูกกับบัญชี LINE อยู่:   ${bound}`);

  if (bound === 0) {
    console.log("\nไม่มีแถวไหนผูกไว้อยู่แล้ว ไม่ต้องทำอะไร");
    return;
  }

  // A few examples, so it's obvious at a glance whether these are the stale
  // ids from the old OA or bindings members have already rebuilt on the new
  // one — clearing the latter would make everyone identify themselves again
  // for no reason.
  const sample = await prisma.memberRoster.findMany({
    where: { lineUserId: { not: null } },
    select: { memberNumber: true, memberName: true, lineUserId: true },
    take: 5,
    orderBy: { memberNumber: "asc" },
  });
  console.log("\nตัวอย่างที่จะถูกล้าง:");
  for (const m of sample) {
    console.log(`  ${m.memberNumber}  ${m.memberName}  ${m.lineUserId}`);
  }

  if (!confirmed) {
    console.log(
      `\n[ยังไม่ได้แก้อะไร] ถ้าถูกต้องแล้ว รันซ้ำด้วย --yes เพื่อล้างทั้ง ${bound} แถว`
    );
    return;
  }

  const { count } = await prisma.memberRoster.updateMany({
    where: { lineUserId: { not: null } },
    data: { lineUserId: null },
  });
  console.log(`\nล้างแล้ว ${count} แถว`);
  console.log(
    "สมาชิกจะผูกกับบัญชี LINE ใหม่ให้เองอัตโนมัติ ตอนแจ้งชื่อ-เลขสมาชิกกับบอทครั้งถัดไป"
  );
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
