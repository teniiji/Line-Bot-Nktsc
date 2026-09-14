import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// The directory of employing units that receive รายการหัก each month. Imported
// from the "หน่วยงาน" sheet by scripts/import-org-data.ts, but editable here
// too: a unit's LINE contact goes stale on its own schedule (the officer
// changes, they get a new phone, the cooperative moves LINE OA and every id
// in the table is invalidated at once), and until this existed the only way
// to correct one was to edit the spreadsheet and re-run the import — which
// nobody is going to do mid-round with a failed send in front of them.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { groupName: { contains: search, mode: "insensitive" as const } },
          { contactName: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const units = await prisma.organizationUnit.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      groupName: true,
      contactName: true,
      email: true,
      lineUserId: true,
      contactMethod: true,
      note: true,
    },
  });

  return NextResponse.json({ data: units });
}
