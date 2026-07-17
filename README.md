# Line-Bot-Nktsc
ไลน์ OA ตอบคำถามสมาชิกสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด
(Next.js App Router + TypeScript + Prisma/PostgreSQL + Claude API)

---

## 📌 ภาพรวมและสถิติสำคัญ (สิ้นปี 2568)
* **สมาชิก:** ทั้งหมด 1,249 ราย (มีเงินกู้ 970 ราย)
* **ทุนเรือนหุ้นรวม:** 720,782,102 บาท
* **ช่องทางบริการ:** ตรวจสอบธุรกรรม/ข้อมูลผ่าน แอปสหกรณ์ & LINE OA

### 💰 บริการทางการเงิน
| ประเภทเงินฝาก | ดอกเบี้ย (ต่อปี) |
| --- | --- |
| ออมทรัพย์ / ATM | 1.25% |
| ออมทรัพย์พิเศษ | 3.00% |
| ประจำ 6 / 12 เดือน | 2.75% / 3.50% |

* **อัตราดอกเบี้ยเงินกู้:** ทั่วไป 5.25% ต่อปี (สามัญ/ดำรงชีพ/โอนหนี้/ปรับโครงสร้าง) | โครงการพิเศษ (72 งวด) 4.50% ต่อปี
* **สวัสดิการ:** ทุนการศึกษาบุตรประจำปี, การสงเคราะห์ (ส.ส.ค.), เงินปันผลและเฉลี่ยคืน

---

## 🤖 ระบบการทำงานหลัก (System Architecture)
บอทรับ Webhook จาก LINE -> เรียกใช้งาน Claude (Tool-use Agent) ใน `lib/financeAgent.ts` เพื่อประมวลผล:
1. **บันทึกรายการ:** ตรวจสอบสลิป (ยอดตรง, บัญชีปลายทางสหกรณ์, ป้องกันสลิปซ้ำด้วย SHA-256) และแยกประเภทรายการ (ฝากเงิน, ซื้อหุ้น, ชำระหนี้)
2. **ยืนยันตัวตน:** เทียบข้อมูลกับฐานข้อมูลทะเบียนสมาชิก (`MemberRoster`) 
3. **ระบบตอบคำถาม (Knowledge Base):** ตอบคำถามอัตราดอกเบี้ย/สวัสดิการจากตาราง `KnowledgeEntry` (Fallback ไปที่ `lib/knowledge.ts`) 
4. **ความปลอดภัย:** กรองลิงก์ที่ไม่ใช่โดเมนสหกรณ์ (`nktscoop.com`) ออกจากคำตอบทั้งหมดผ่าน `stripDisallowedLinks`

### 🎯 การจับคู่ผู้รับผิดชอบเรื่องกู้เงิน (Loan Routing)
คำขอที่แผนก "สินเชื่อ" หาผู้รับตามลำดับความสำคัญ (`resolveForwardTarget` ใน `lib/financeAgent.ts`, precedence อยู่ใน `lib/loanRouting.ts`):
1. **รหัสผู้รับผิดชอบรายบุคคล** (`MemberRoster.responsibleCode` จับคู่ `ResponsibleContact.code`) — วิธีหลัก แม่นยำกว่าเพราะเป็นรหัสสั้นๆ ไม่ใช่ข้อความอิสระ นำเข้าด้วย `import-responsible-contacts.ts`
2. **ชื่อหน่วยงาน** (`MemberRoster.unitName` จับคู่ `LoanDistrictContact.unitName` แบบตรงตัว) — fallback สำรอง นำเข้าด้วย `import-loan-contacts.ts`
3. **`LINE_FORWARD_LOAN_ID`** — fallback สุดท้ายเมื่อไม่มีทั้งสองข้อบน

### 💻 แดชบอร์ดเจ้าหน้าที่ (Dashboard)
เข้าถึงผ่านหน้าแรก (`/`) ป้องกันด้วย **Basic Auth** (`middleware.ts`):
* **ภาพรวมธุรกรรม:** ยอดรวมประจำเดือน กราฟแยกหมวดหมู่ และส่งออก CSV (BOM Excel)
* **คิวตรวจสอบ:** จัดการกรณี `memberVerified = false` เพื่อผูก LINE ID เข้ากับทะเบียนสมาชิก
* **ทะเบียนคำขอบริการ:** ตารางส่งต่อคำขอเอกสารประกอบ พร้อมรูปถ่ายและเบอร์ติดต่อ
* **การจัดการฐานความรู้:** แก้ไขค่าบริการ/ดอกเบี้ย/สวัสดิการในตาราง `KnowledgeEntry` ได้โดยตรง (Cache 60 วินาที)

---

## ⚙️ การตั้งค่าสภาพแวดล้อม (Environment Variables)
คัดลอก `.env.example` ไปเป็น `.env` และตั้งค่าตัวแปรหลัก:
* `DATABASE_URL`: Connection string ของ PostgreSQL
* `LINE_CHANNEL_SECRET` & `LINE_CHANNEL_ACCESS_TOKEN`: คีย์ของ LINE Messaging API
* `ANTHROPIC_API_KEY`: API Key ของ Claude (Anthropic)
* `BLOB_READ_WRITE_TOKEN`: (Optional) สำหรับ Vercel Blob สำรองรูปสลิป
* `LINE_FORWARD_LOAN_ID` & `LINE_FORWARD_GENERAL_ID`: LINE ID เจ้าหน้าที่สำหรับส่งต่อคำขอ (ตั้ง `LOG_EVENT_SOURCES=1` ชั่วคราวเพื่อหา ID ใน Log ได้)

---

## 🛠️ คำสั่งการใช้งาน (Commands)

```bash
# ติดตั้ง Library
npm install

# การจัดการฐานข้อมูล (Prisma)
npx prisma migrate dev       # ตอนพัฒนาในเครื่อง
npx prisma migrate deploy    # ตอนขึ้น Production

# นำเข้าข้อมูลอ้างอิงจาก Excel (ไม่บังคับ)
npx tsx scripts/import-org-data.ts <path-to-file.xlsx>              # นำเข้าสมาชิก/หน่วยงาน (รวมรหัสผู้รับผิดชอบจากคอลัมน์ H)
npx tsx scripts/import-responsible-contacts.ts <path-to-file.xlsx>  # นำเข้ารหัส -> LINE UserId ผู้รับผิดชอบ (วิธีจับคู่หลัก)
npx tsx scripts/import-loan-contacts.ts <path-to-file.xlsx>         # นำเข้าผู้รับผิดชอบตามชื่อหน่วยงาน (fallback สำรอง)
npx tsx scripts/inspect-responsible-codes.ts <path-to-file.xlsx>    # ตรวจโครงสร้างไฟล์ก่อน import จริง (read-only)

# รันระบบและตรวจสอบ
npm run dev                  # รัน Local server (ตั้ง Webhook ไปที่ /api/line/webhook)
npx tsc --noEmit             # ตรวจสอบ TypeScript
npm test                     # รัน Unit Tests (Vitest)
npm run build                # บิลด์ระบบสำหรับ Deploy
