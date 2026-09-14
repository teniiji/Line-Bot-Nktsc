import { NextResponse } from "next/server";
import { BANK_ACCOUNT_TEMPLATE } from "@/lib/sheetTemplates";
import { buildTemplateWorkbook } from "@/lib/templateWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const file = await buildTemplateWorkbook(BANK_ACCOUNT_TEMPLATE);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${BANK_ACCOUNT_TEMPLATE.fileName}"`,
    },
  });
}
