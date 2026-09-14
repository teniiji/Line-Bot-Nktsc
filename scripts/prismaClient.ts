// A PrismaClient for the scripts, that says so when it is out of date.
//
// The scripts run on a staff machine, not on Vercel, and that machine only
// runs them occasionally. `git pull` brings down a schema with new models;
// the generated client in node_modules stays whatever it was the last time
// somebody ran `npx prisma generate` there. Nothing warns about the gap.
//
// What that looks like is this:
//
//   TypeError: Cannot read properties of undefined (reading 'findMany')
//       at main (scripts/why-unmatched.ts:45:26)
//
// — which reads like the script is broken, and sends the person reading it
// into the script instead of to the one command that fixes it. So the client
// is asked up front whether it has the models the script is about to use, and
// says the command when it does not.
//
// Deliberately not a schema-version check: the question that matters is only
// ever "does this client know the models I am about to touch", and asking it
// directly needs nothing kept in sync.

import { PrismaClient } from "@prisma/client";

export function scriptPrisma(...models: string[]): PrismaClient {
  const prisma = new PrismaClient();

  const missing = models.filter(
    (model) => typeof (prisma as unknown as Record<string, unknown>)[model] !== "object"
  );

  if (missing.length > 0) {
    console.error(
      `Prisma client ในเครื่องนี้ยังไม่รู้จักตาราง: ${missing.join(", ")}\n` +
        "แปลว่า client ที่ generate ไว้เก่ากว่า schema ที่เพิ่ง pull มา\n\n" +
        "แก้โดยรัน:\n" +
        "  npx prisma generate\n\n" +
        "แล้วรันสคริปต์นี้ใหม่อีกครั้ง"
    );
    process.exit(1);
  }

  return prisma;
}
