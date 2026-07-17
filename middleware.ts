import { NextRequest, NextResponse } from "next/server";
import { checkBasicAuth } from "@/lib/basicAuth";

// Basic Auth in front of the staff dashboard and its APIs. The LINE
// webhook is excluded — LINE's servers can't send credentials, and that
// route already authenticates every request via signature validation.
export const config = {
  matcher: ["/((?!api/line/webhook|_next/|favicon.ico).*)"],
};

export function middleware(request: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;

  // Fail closed: without configured credentials the dashboard stays
  // inaccessible instead of silently open — this data is members'
  // financial records.
  if (!user || !password) {
    return new NextResponse(
      "Dashboard is disabled. Set DASHBOARD_USER and DASHBOARD_PASSWORD to enable it.",
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization") ?? "";
  if (checkBasicAuth(header, user, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="NKTSC Dashboard"' },
  });
}
