-- CreateTable
CREATE TABLE "StaffHandoff" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "memberName" TEXT,
    "memberNumber" TEXT,
    "kind" TEXT NOT NULL,
    "department" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notifiedTo" TEXT,
    "notifyError" TEXT,
    "claimedBy" TEXT,
    "claimedByLineUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffHandoff_lineUserId_createdAt_idx" ON "StaffHandoff"("lineUserId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffHandoff_status_idx" ON "StaffHandoff"("status");

-- Switch for the after-hours acknowledgement (lib/staffHandoff.ts).
INSERT INTO "FeatureFlag" ("id", "key", "label", "enabled", "updatedAt") VALUES
  ('flag_after_hours_ack_enabled', 'after_hours_ack_enabled', 'นอกเวลาทำการ: ตอบสมาชิกว่าได้รับข้อความแล้ว เมื่อบอทส่งเรื่องให้เจ้าหน้าที่ (เจ้าหน้าที่จะตอบในเวลาทำการ)', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
