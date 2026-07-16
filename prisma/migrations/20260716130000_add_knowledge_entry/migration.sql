-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_key_key" ON "KnowledgeEntry"("key");

-- Seed with the reference data previously hard-coded in the agent's system
-- prompt (lib/financeAgent.ts), so bot behavior is unchanged after deploy.
-- Kept in sync with DEFAULT_KNOWLEDGE in lib/knowledge.ts.
INSERT INTO "KnowledgeEntry" ("id", "key", "title", "content", "sortOrder", "updatedAt") VALUES
  ('know_deposit_rates', 'deposit_rates', 'อัตราดอกเบี้ยเงินฝาก (ต่อปี)', 'ออมทรัพย์ / ออมทรัพย์ ATM 1.25% | ออมทรัพย์พิเศษ 3.00% | ประจำ 6 เดือน 2.75% | ประจำ 12 เดือน 3.50% (ข้อมูล ณ สิ้นปี 2568)', 1, CURRENT_TIMESTAMP),
  ('know_loan_rates', 'loan_rates', 'อัตราดอกเบี้ยเงินกู้ (ต่อปี)', 'ทั่วไป (เงินกู้สามัญ, เพื่อการดำรงชีพ, เพื่อการโอนหนี้, ปรับโครงสร้างหนี้) 5.25% | โครงการพิเศษดอกเบี้ยต่ำ (72 งวด) 4.50% (ข้อมูล ณ สิ้นปี 2568)', 2, CURRENT_TIMESTAMP),
  ('know_welfare', 'welfare', 'สวัสดิการสมาชิก', 'ทุนการศึกษาบุตรสมาชิกจ่ายเป็นประจำทุกปี, การสงเคราะห์ผ่านสมาคมฌาปนกิจสงเคราะห์สมาชิกสหกรณ์ (ส.ส.ค.), เงินปันผลและเฉลี่ยคืนตามหุ้น/ธุรกิจ', 3, CURRENT_TIMESTAMP),
  ('know_contact', 'contact', 'ข้อมูลติดต่อ', 'ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์บริหารสำนักงาน 042-411334, 042-423355, 042420746 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | อีเมล nktsc.org@gmail.com', 4, CURRENT_TIMESTAMP);
