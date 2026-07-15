# Line-Bot-Nktsc
ไลน์ OA ตอบคำถามสมาชิกสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด
สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด (Nongkhai Teachers Saving Cooperative Limited)
วิสัยทัศน์: "สถาบันการเงินที่มีความมั่นคง ได้มาตรฐาน บริการฉับไว ด้วยเทคโนโลยีที่ทันสมัย ประทับใจสมาชิก ภายใต้หลักธรรมาภิบาล"
📌 ภาพรวมองค์กร
สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด เป็นสถาบันการเงินที่มุ่งเน้นการส่งเสริมการออมและการให้บริการสินเชื่อแก่สมาชิกที่เป็นบุคลากรทางการศึกษาในจังหวัดหนองคาย โดยมีการบริหารจัดการที่โปร่งใสตามหลักธรรมาภิบาล (Good Governance)
,
สถิติสำคัญ (ข้อมูลสิ้นปี 2568)
จำนวนสมาชิกทั้งหมด: 1,249 ราย
สมาชิกที่มีเงินกู้: 970 ราย
ทุนเรือนหุ้นรวม: 720,782,102 บาท
💰 บริการทางการเงิน
1. บริการเงินฝาก (Interest Rates)
ประเภทเงินฝาก
อัตราดอกเบี้ย (ต่อปี)
ออมทรัพย์ / ออมทรัพย์ ATM
1.25%
ออมทรัพย์พิเศษ
3.00%
ประจำ 6 เดือน
2.75%
ประจำ 12 เดือน
3.50%
2. บริการเงินกู้ (Loan Rates)
อัตราดอกเบี้ยทั่วไป: 5.25% ต่อปี (สำหรับเงินกู้สามัญ, เพื่อการดำรงชีพ, เพื่อการโอนหนี้ และปรับโครงสร้างหนี้)
โครงการพิเศษ: เงินกู้พิเศษดอกเบี้ยต่ำ (72 งวด) อัตรา 4.50% ต่อปี
🎓 สวัสดิการและกิจกรรมสมาชิก
ทุนการศึกษา: มีการจ่ายเงินทุนการศึกษาบุตรสมาชิกเป็นประจำทุกปี
,
การสงเคราะห์: ดำเนินการผ่านสมาคมฌาปนกิจสงเคราะห์สมาชิกสหกรณ์ (ส.ส.ค.) เพื่อดูแลสมาชิกและครอบครัว
,
ปันผลและเฉลี่ยคืน: มีการจัดสรรเงินปันผลตามหุ้นและเงินเฉลี่ยคืนตามส่วนธุรกิจให้แก่สมาชิก
,
🛠 การดำเนินงานและเทคโนโลยี
ความโปร่งใส: สมาชิกสามารถตรวจสอบรายการย่อแสดงสินทรัพย์และหนี้สินได้เป็นรายเดือน และมีการเผยแพร่รายงานประจำปีอย่างต่อเนื่อง
,
ช่องทางดิจิทัล: รองรับการใช้งานผ่าน แอปพลิเคชันสหกรณ์ เพื่ออำนวยความสะดวกในการตรวจสอบข้อมูลและทำธุรกรรม
การสื่อสาร: มีวารสารประชาสัมพันธ์รายเดือนเพื่อแจ้งข่าวสารและกิจกรรมต่างๆ
📞 ข้อมูลการติดต่อ
ที่อยู่: 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000
โทรศัพท์:
บริหารสำนักงาน: 042-411334, 042-423355, 042420746
หุ้น-หนี้: 042-420495
สมาคมฌาปนกิจ (สสค.): 042-413276, 064-8766432
เว็บไซต์: www.nktscoop.com
อีเมล: nktsc.org@gmail.com

---

## 🤖 การพัฒนา (Development)

โปรเจกต์นี้เป็น LINE Official Account bot ที่สร้างด้วย Next.js (App Router) + TypeScript รับข้อความ/รูปสลิปจากสมาชิกผ่าน LINE webhook แล้วใช้ Claude (Anthropic) เป็น tool-use agent เพื่อจำแนกประเภทและบันทึกธุรกรรมทางการเงินของสมาชิกลงฐานข้อมูลผ่าน Prisma

### โครงสร้างหลัก

- `app/api/line/webhook/route.ts` — LINE webhook handler (ตรวจ signature, กันข้อความซ้ำ, เรียก finance agent, ตอบกลับผ่าน LINE)
- `app/api/line-users/route.ts`, `app/api/line-users/[id]/route.ts` — endpoint จัดการรายชื่อ/nickname สมาชิกที่เคยทักบอท
- `lib/financeAgent.ts` — Claude tool-use agent ที่อ่านข้อความ/สลิป แล้วเลือกหมวดหมู่และบันทึกรายการ
- `lib/lineClient.ts`, `lib/anthropicClient.ts`, `lib/lineUsers.ts`, `lib/categories.ts`, `lib/prisma.ts` — ไลบรารีสนับสนุน
- `prisma/schema.prisma` — โมเดล `Expense`, `LineUser`, `ProcessedLineEvent`, `PendingTransaction`, `PendingServiceRequest` (เอกสารประกอบที่รอส่งต่อ), `OrganizationUnit`/`MemberRoster` (ข้อมูลอ้างอิงหน่วยงาน/สมาชิกที่นำเข้าจากสเปรดชีต), `LoanDistrictContact` (ผู้รับผิดชอบเรื่องกู้เงินแยกตามอำเภอ)
- `lib/financeAgent.ts` — นอกจากบันทึกธุรกรรม ยังยืนยันตัวตนสมาชิกกับ roster, ตรวจสลิป (ยอดตรง + บัญชีปลายทางเป็นสหกรณ์ + กันสลิปซ้ำด้วย SHA-256), ส่งต่อคำขอเอกสารประกอบไปยังเจ้าหน้าที่ที่รับผิดชอบ, ตอบคำถามเกี่ยวกับอัตราดอกเบี้ย/สวัสดิการ/แบบฟอร์มจากข้อมูล static ที่ฝังไว้ในพรอมป์ (ดูหัวข้อด้านล่าง), และกรองลิงก์ที่ไม่ใช่โดเมนสหกรณ์ออกจากทุกคำตอบก่อนส่งกลับ (`stripDisallowedLinks`)

### เตรียมสภาพแวดล้อม

ต้องมี Node.js 18+ และฐานข้อมูล PostgreSQL

```bash
npm install
cp .env.example .env   # แล้วกรอกค่าจริงตามหัวข้อถัดไป
```

ตัวแปรที่ต้องตั้งค่าใน `.env` (ดูรายละเอียดใน `.env.example`):

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `DATABASE_URL` | connection string ของ PostgreSQL |
| `LINE_CHANNEL_SECRET` | จาก LINE Developers Console > channel > Messaging API tab ใช้ตรวจสอบลายเซ็น webhook |
| `LINE_CHANNEL_ACCESS_TOKEN` | ใช้เรียก LINE Messaging API (ตอบข้อความ, ดึงรูปสลิป, ดึงโปรไฟล์ผู้ใช้) |
| `ANTHROPIC_API_KEY` | จาก [console.anthropic.com](https://console.anthropic.com) ใช้เรียก Claude เป็น finance agent |
| `BLOB_READ_WRITE_TOKEN` | (ไม่บังคับ) Vercel Blob storage สำหรับสำรองรูปสลิป — ถ้าไม่ตั้งค่า ระบบจะข้ามการอัปโหลดรูปแบบเงียบๆ โดยไม่กระทบการบันทึกรายการ |
| `LINE_FORWARD_LOAN_ID` | (ไม่บังคับ) LINE user ID ของผู้รับผิดชอบเรื่องกู้เงินโดยรวม — ใช้เป็น fallback เมื่อยังไม่มี contact เฉพาะอำเภอนั้นใน `LoanDistrictContact` |
| `LINE_FORWARD_GENERAL_ID` | (ไม่บังคับ) LINE user ID ของผู้รับผิดชอบเรื่องอื่นๆ ที่ไม่ใช่เงินกู้ (สมัครสมาชิก, สอบถามทั่วไป) |
| `LOG_EVENT_SOURCES` | (ไม่บังคับ) ตั้งเป็น `1` ชั่วคราวเพื่อ log user/group ID ที่ทักเข้ามา — ใช้หา LINE user ID ของเจ้าหน้าที่สำหรับกรอก `LINE_FORWARD_*` แล้วปิดกลับเป็นค่าว่าง |

ถ้าไม่ตั้งค่าตัวใดตัวหนึ่งไว้ บอทจะขอโทษและแนะนำให้ติดต่อสำนักงานสหกรณ์โดยตรงแทน ไม่ส่งต่อจริง (ไม่โกหกผู้ใช้ว่าส่งสำเร็จ)

**หมายเหตุ**: บัญชี LINE Official Account แบบ Unverified (ค่าเริ่มต้นของบัญชีฟรี) ไม่สามารถถูกเชิญเข้ากลุ่มแชทได้ ต้องใช้ LINE user ID ของพนักงานคนใดคนหนึ่งโดยตรง (ให้พนักงานเพิ่มบอทเป็นเพื่อนแล้วทักมา 1 ครั้ง)

วิธีหา LINE user ID: ตั้งค่า `LOG_EVENT_SOURCES=1` ไว้ชั่วคราว (มีตัวแปรนี้ให้อยู่แล้ว ไม่ต้องแก้โค้ด) แล้วให้คนนั้นทักบอทหรือพิมพ์อะไรก็ได้ ดู `userId` จาก log ที่ขึ้น (`[line/webhook] event sources: ...`) คัดลอกมาใส่ตัวแปรที่เกี่ยวข้อง แล้ว**ลบ/ปิด `LOG_EVENT_SOURCES` กลับเป็นค่าว่าง**ทันทีที่ได้ id ครบ เพื่อไม่ให้ user ID ของสมาชิกถูก log ระหว่างใช้งานปกติ

### แยกเรื่องกู้เงินตามอำเภอ (ไม่บังคับ)

การกู้เงินจะพยายามหาผู้รับผิดชอบเฉพาะอำเภอของสมาชิกก่อน (จากตาราง `LoanDistrictContact`) แล้วค่อย fallback ไป `LINE_FORWARD_LOAN_ID` ถ้ายังไม่มี ตารางนี้เริ่มต้นว่างเปล่าโดยตั้งใจ — ต้องเพิ่มเองทีละอำเภอเมื่อยืนยันตัวผู้รับผิดชอบแล้ว เช่นผ่าน Prisma Studio (`npx prisma studio`) หรือ SQL ตรงๆ:

```sql
INSERT INTO "LoanDistrictContact" (id, district, "lineUserId", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'อ.เมือง', 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', now(), now());
```

### นำเข้าข้อมูลหน่วยงาน/สมาชิกจากสเปรดชีตเดิม (ไม่บังคับ)

ถ้ามีสเปรดชีต "หน่วยงาน" / "สมาชิก_LINE_OA" ของระบบเดิมอยู่แล้ว รันสคริปต์นี้เพื่อนำเข้า (ใช้จับคู่สมาชิกกับอำเภอตอน routing เรื่องกู้เงิน):

```bash
npx tsx scripts/import-org-data.ts path/to/spreadsheet.xlsx
```

**อย่า commit ไฟล์สเปรดชีตนี้เข้า git เด็ดขาด** เพราะมีชื่อ-นามสกุลและ LINE user ID ของสมาชิกจริงหลายพันคน — เก็บไว้ในเครื่องแล้วรันสคริปต์ตรงๆ เท่านั้น

### ข้อมูลอ้างอิงของสหกรณ์ในบอท (อัตราดอกเบี้ย/สวัสดิการ/แบบฟอร์ม)

เมื่อสมาชิกถามอัตราดอกเบี้ยเงินฝาก/เงินกู้, สวัสดิการ, ข้อมูลติดต่อ, หรือขอแบบฟอร์ม บอทจะตอบจาก**ข้อมูล static ที่ฝังไว้ตรงๆ** ในส่วนต้นของ `buildSystemPrompt` (`lib/financeAgent.ts`) ไม่ใช่การค้นเว็บสด — **ต้องแก้ค่าพวกนี้ในโค้ดเองทุกครั้งที่สหกรณ์เปลี่ยนอัตราดอกเบี้ยหรือปรับปรุงหน้าเว็บ** แล้ว commit + deploy ใหม่ ไม่มีการอัปเดตอัตโนมัติ

**เหตุผลที่ไม่ให้บอทค้นเว็บสด (`web_search`/`web_fetch`)**: เคยลองเปิดใช้งานแล้วพบว่า LINE แสดงลิงก์ตัวอย่างของเว็บพนัน/หวยออนไลน์ติดมากับคำตอบของบอท (ตรวจสอบแล้วว่าเว็บสหกรณ์เองไม่ได้ถูกแฮ็ก น่าจะมาจากโฆษณาที่ฝังอยู่ในหน้าเว็บที่ถูกดึงเนื้อหามาแล้วโมเดลหยิบลิงก์นั้นมาใส่ในคำตอบโดยไม่ตั้งใจ) จึงปิดการใช้ `web_search`/`web_fetch` ไปจนกว่าจะมั่นใจว่าปลอดภัยพอ และเปลี่ยนมาใช้ข้อมูล static แทนซึ่งควบคุมเนื้อหาได้ 100%

มีตัวกรองป้องกันชั้นที่สองอยู่แล้ว (`stripDisallowedLinks` ใน `lib/financeAgent.ts`) ที่จะตัดลิงก์ใดๆ ที่ไม่ใช่โดเมน `nktscoop.com`/`www.nktscoop.com` ออกจากทุกคำตอบก่อนส่งไป LINE เสมอ ไม่ว่าจะเปิดใช้ tool ค้นเว็บหรือไม่ — ถ้าจะเปิด `web_search`/`web_fetch` กลับมาใช้ในอนาคต ตัวกรองนี้จะยังทำงานป้องกันอยู่ แต่ควรตรวจสอบเพิ่มเติมก่อนว่าเว็บสหกรณ์ไม่มีโฆษณา/สคริปต์จากบุคคลที่สามที่อาจติดมากับเนื้อหาที่ดึงมา

### ตั้งค่าฐานข้อมูล

โปรเจกต์มี migration history อยู่แล้วใน `prisma/migrations/` ให้รันคำสั่งใดคำสั่งหนึ่งตามสถานการณ์:

```bash
# ฐานข้อมูล production/staging ที่ยังไม่มี schema นี้ (ใช้ migration ที่มีอยู่ตรงๆ)
npx prisma migrate deploy

# ระหว่างพัฒนาในเครื่อง ต้องการให้ Prisma ตรวจสอบ/สร้าง migration ใหม่ถ้ามีการแก้ schema
npx prisma migrate dev
```

### รันในเครื่อง

```bash
npm run dev
```

จากนั้นตั้งค่า Webhook URL ใน LINE Developers Console ให้ชี้ไปที่ `https://<your-domain>/api/line/webhook` (ต้องเป็น HTTPS ที่เข้าถึงได้จากอินเทอร์เน็ต เช่น ngrok ตอน dev หรือโดเมนจริงตอน deploy) และเปิด "Use webhook" ไว้

### ตรวจสอบก่อน deploy

```bash
npx tsc --noEmit
npm run build
```

### Deploy ขึ้น Vercel (production)

โปรเจกต์นี้เป็น Next.js App Router รันบน Vercel ได้ตรงๆ ขั้นตอน:

1. **เชื่อม repo กับ Vercel** — สร้าง project ใหม่บน Vercel แล้วเลือก GitHub repo นี้ (branch ที่จะ deploy เช่น `main`) Vercel จะตรวจเจอ Next.js และตั้ง Framework Preset ให้เอง
2. **ตั้งค่า Environment Variables** ใน Vercel (Settings > Environment Variables) ให้ครบตามตารางด้านบน — อย่างน้อยต้องมี `DATABASE_URL`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` ส่วน `LINE_FORWARD_LOAN_ID`/`LINE_FORWARD_GENERAL_ID` ใส่เมื่อได้ LINE user ID ของเจ้าหน้าที่แล้ว
   - ใช้ Neon เป็นฐานข้อมูล: คัดลอก connection string แบบ **pooled** (`...-pooler...`) มาใส่ `DATABASE_URL` เพื่อให้เข้ากับ serverless functions ได้ดี
   - ถ้าจะสำรองรูปสลิป ให้สร้าง Blob store ใน Storage tab แล้ว `BLOB_READ_WRITE_TOKEN` จะถูก inject ให้อัตโนมัติ (ถ้าไม่สร้าง ระบบจะข้ามการอัปโหลดแบบเงียบๆ)
3. **ให้ migration ทำงานตอน build** — ตั้ง Build Command ใน Vercel (Settings > General > Build & Development Settings) เป็น:

   ```bash
   prisma migrate deploy && next build
   ```

   `postinstall` รัน `prisma generate` ให้อยู่แล้ว ส่วน `prisma migrate deploy` จะ apply migration ที่มีอยู่กับฐานข้อมูล production (ไม่สร้าง migration ใหม่ ปลอดภัยกับข้อมูลจริง) — หรือจะรัน `npx prisma migrate deploy` เองครั้งเดียวจากเครื่องที่ชี้ `DATABASE_URL` ไป production ก็ได้ แล้วปล่อย Build Command เป็นค่า default
4. **อัปเดต Webhook URL ใน LINE** — หลัง deploy สำเร็จ จะได้โดเมนถาวรจาก Vercel (เช่น `https://your-app.vercel.app`) เอาไปตั้งใน LINE Developers Console > Messaging API > Webhook URL เป็น `https://your-app.vercel.app/api/line/webhook` กด Verify แล้วเปิด "Use webhook" ไว้ — จากนี้ไม่ต้องใช้ ngrok หรือเปิดเครื่องทิ้งไว้แล้ว
5. **นำเข้าข้อมูลอ้างอิง (ครั้งเดียว)** — ถ้ายังไม่ได้นำเข้า ให้รัน `npx tsx scripts/import-org-data.ts <ไฟล์.xlsx>` จากเครื่องที่ชี้ `DATABASE_URL` ไป production (อย่า commit ไฟล์สเปรดชีต) และเพิ่มผู้รับผิดชอบเรื่องกู้เงินแยกอำเภอใน `LoanDistrictContact` ตามหัวข้อด้านบนเมื่อยืนยันตัวบุคคลแล้ว
