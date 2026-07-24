-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- Seed every switch enabled (true) so behavior is unchanged right after
-- deploy — staff opt into pausing something, nothing is silently disabled.
-- Kept in sync with DEFAULT_FLAGS in lib/featureFlags.ts.
INSERT INTO "FeatureFlag" ("id", "key", "label", "enabled", "updatedAt") VALUES
  ('flag_messaging_enabled', 'messaging_enabled', 'รับข้อความจากสมาชิก (ปิด = โหมดปิดปรับปรุงระบบทั้งหมด)', true, CURRENT_TIMESTAMP),
  ('flag_transactions_enabled', 'transactions_enabled', 'รับบันทึกธุรกรรมจากสลิป', true, CURRENT_TIMESTAMP),
  ('flag_service_requests_enabled', 'service_requests_enabled', 'รับคำขอบริการ/ส่งต่อเจ้าหน้าที่', true, CURRENT_TIMESTAMP),
  ('flag_member_lookup_enabled', 'member_lookup_enabled', 'ค้นหาเลขสมาชิก (ยืนยันตัวตน)', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_1', 'dept_notify_สินเชื่อ', 'แจ้งเตือนแผนก สินเชื่อ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_2', 'dept_notify_เงินฝาก', 'แจ้งเตือนแผนก เงินฝาก', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_3', 'dept_notify_สารสนเทศ', 'แจ้งเตือนแผนก สารสนเทศ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_4', 'dept_notify_สวัสดิการ', 'แจ้งเตือนแผนก สวัสดิการ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_5', 'dept_notify_นิติการ', 'แจ้งเตือนแผนก นิติการ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_6', 'dept_notify_บัญชี', 'แจ้งเตือนแผนก บัญชี', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_7', 'dept_notify_ฌาปนกิจ', 'แจ้งเตือนแผนก ฌาปนกิจ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_8', 'dept_notify_บริหารสำนักงาน/ธุรการ', 'แจ้งเตือนแผนก บริหารสำนักงาน/ธุรการ', true, CURRENT_TIMESTAMP),
  ('flag_dept_notify_9', 'dept_notify_อื่นๆ', 'แจ้งเตือนแผนก อื่นๆ', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
