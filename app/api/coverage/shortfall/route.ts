import { NextRequest, NextResponse } from "next/server";
import { queryCoverage } from "@/lib/coverageStore";
import { buildShortfallWorkbook, shortfallFileName } from "@/lib/shortfallWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// รายชื่อสมาชิกที่หลักประกันไม่ครอบคลุมหนี้, as an Excel file to print: the
// coverage list's own filters (unit, age, …) and order, always narrowed to
// the members whose collateral falls short.
export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  searchParams.set("status", "short");
  const result = await queryCoverage(searchParams);
  if (!result) return NextResponse.json({ error: "ยังไม่มีข้อมูลประกันและหลักประกัน" }, { status: 404 });

  const file = await buildShortfallWorkbook(result.sorted, { asOf: result.figuresAsOf });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shortfall.xlsx"; filename*=UTF-8''${encodeURIComponent(shortfallFileName(result.figuresAsOf))}`,
    },
  });
}
