-- Slips paying ชำระเก็บไม่ได้รายเดือน are recorded but no longer pushed to the
-- member's loan officer (lib/featureFlags.ts, categoryNotifyKey). A switch in
-- ตั้งค่าระบบ turns it back on.
INSERT INTO "FeatureFlag" ("id", "key", "label", "enabled", "updatedAt") VALUES
  ('flag_category_notify_deduction', 'category_notify_ชำระเก็บไม่ได้รายเดือน', 'ส่งต่อสลิปชำระเก็บไม่ได้รายเดือนให้เจ้าหน้าที่ (ปิด = บันทึกอย่างเดียว ดูได้ที่หน้าเทียบ Statement / รายการ)', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "enabled" = false;
