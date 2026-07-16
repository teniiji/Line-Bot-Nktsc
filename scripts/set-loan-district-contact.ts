// One-off/occasional helper: sets (or clears) who a สินเชื่อ (loan) service
// request for one district forwards to, overriding the LINE_FORWARD_LOAN_ID
// fallback for that district only. Run this once per district — never
// hardcode real staff LINE user IDs into this file or commit them anywhere
// in the repo, always pass them as CLI args against a local DATABASE_URL.
//
// Usage:
//   npx tsx scripts/set-loan-district-contact.ts "อ.เมือง" <lineUserId> ["note"]
//   npx tsx scripts/set-loan-district-contact.ts "อ.เมือง" --clear

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [district, lineUserIdOrFlag, note] = process.argv.slice(2);
  if (!district || !lineUserIdOrFlag) {
    console.error(
      'Usage: npx tsx scripts/set-loan-district-contact.ts "อ.เขต" <lineUserId> ["note"]\n' +
        '   or: npx tsx scripts/set-loan-district-contact.ts "อ.เขต" --clear'
    );
    process.exit(1);
  }

  if (lineUserIdOrFlag === "--clear") {
    const deleted = await prisma.loanDistrictContact
      .delete({ where: { district } })
      .catch(() => null);
    console.log(
      deleted
        ? `Cleared contact for ${district} — will fall back to LINE_FORWARD_LOAN_ID.`
        : `No contact was set for ${district}, nothing to clear.`
    );
    return;
  }

  const lineUserId = lineUserIdOrFlag;
  const contact = await prisma.loanDistrictContact.upsert({
    where: { district },
    create: { district, lineUserId, note: note ?? null },
    update: { lineUserId, note: note ?? null },
  });
  console.log(
    `Set ${contact.district} -> ${contact.lineUserId}${
      contact.note ? ` (${contact.note})` : ""
    }`
  );
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
