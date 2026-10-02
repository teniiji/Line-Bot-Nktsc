import { NextResponse } from "next/server";
import { autoLinkOffices } from "@/lib/unitPayerOfficeStore";

export const dynamic = "force-dynamic";

// "🔗 ผูกอัตโนมัติ": every unit whose office the out-of-province list makes
// plain gets linked, and its members brought in — see planAutoLinks.
export async function POST() {
  return NextResponse.json(await autoLinkOffices());
}
