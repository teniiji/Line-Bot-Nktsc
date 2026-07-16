import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="th">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
