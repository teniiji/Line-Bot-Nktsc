// One-off helper: after scripts/import-org-data.ts has loaded MemberRoster,
// run this to see every district code the loan-forwarding logic can
// extract from unitName (same regex as extractDistrict in
// lib/financeAgent.ts), how many members are in each, and whether
// LoanDistrictContact already has a contact set for it. Use this to know
// exactly which district strings to pass to
// scripts/set-loan-district-contact.ts.
//
// Usage: npx tsx scripts/list-loan-districts.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Kept in sync with extractDistrict() in lib/financeAgent.ts.
function extractDistrict(unitName: string): string | null {
  const match = unitName.match(/อ\.[ก-๙A-Za-z]+/);
  return match ? match[0] : null;
}

async function main() {
  const roster = await prisma.memberRoster.findMany({
    select: { unitName: true },
  });

  const counts = new Map<string, number>();
  let noDistrict = 0;
  for (const { unitName } of roster) {
    const district = unitName ? extractDistrict(unitName) : null;
    if (!district) {
      noDistrict++;
      continue;
    }
    counts.set(district, (counts.get(district) ?? 0) + 1);
  }

  const contacts = await prisma.loanDistrictContact.findMany();
  const contactSet = new Set(contacts.map((c) => c.district));

  const districts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Found ${districts.length} distinct district(s):\n`);
  for (const [district, count] of districts) {
    const has = contactSet.has(district) ? "already set" : "NOT set";
    console.log(`  ${district}\t${count} member(s)\t[${has}]`);
  }
  console.log(
    `\n${noDistrict} member(s) have no extractable district (falls back to LINE_FORWARD_LOAN_ID).`
  );
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
