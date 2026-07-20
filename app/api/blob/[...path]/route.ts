import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";

// Vercel Blob no longer offers public-access stores through the dashboard
// (only "private" stores, which require an authenticated read) — but LINE's
// servers need to fetch slip/document images by plain URL with no way to
// pass our secret token. This route is the bridge: it reads the blob
// server-side with BLOB_READ_WRITE_TOKEN and streams the bytes back over an
// ordinary, unauthenticated HTTPS URL — functionally the same security
// posture as the old public Vercel Blob URL (unguessable path, not access
// controlled), just hosted on our own domain instead of Vercel's. Must stay
// excluded from the dashboard's Basic Auth (see middleware.ts matcher) or
// LINE's fetch would get a 401.
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const pathname = params.path.join("/");

  const result = await get(pathname, { access: "private" }).catch((err) => {
    console.error("[api/blob] read error:", err);
    return null;
  });

  if (!result || result.statusCode !== 200) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
