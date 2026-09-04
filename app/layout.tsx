import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// The dashboard had no Thai face of its own, so every browser fell back to
// whatever the operating system happened to ship — usually Tahoma on the
// office PCs, which sets Thai loose and flat at table sizes and gives the
// digits uneven widths. IBM Plex Sans Thai is drawn for interfaces, has real
// weights (so a heading is a heading rather than bolder Tahoma), and its
// Latin digits line up in columns, which is what a page of money amounts
// needs. next/font self-hosts the files at build time, so nothing is fetched
// from Google at runtime and the text does not reflow on load.
const sans = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Account numbers are read digit by digit against a bank statement, so they
// get a face where 0 and O cannot be mistaken for each other.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "สหกรณ์ออมทรัพย์ครูหนองคาย — แดชบอร์ดเจ้าหน้าที่",
  description:
    "ภาพรวมธุรกรรมสมาชิก คิวตรวจสอบตัวตน และทะเบียนคำขอบริการของสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-slate-50 text-slate-900 min-h-screen antialiased">
        {/* Wider than the usual reading measure because this dashboard is
            tables, not prose: the เทียบ Statement round is ten columns, and at
            the old 72rem the status — the column staff actually act on — sat
            off the right edge behind a horizontal scroll. */}
        <div className="max-w-[92rem] mx-auto px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
