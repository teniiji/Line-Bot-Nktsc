-- messaging_enabled's behavior changed: disabling it now makes the bot go
-- completely silent (staff answer manually via chat.line.biz) instead of
-- sending an automated apology. Update the label text on existing rows to
-- match — this doesn't touch the "enabled" value itself, so no behavior
-- changes for anyone from running this migration alone.
UPDATE "FeatureFlag"
SET "label" = 'รับข้อความจากสมาชิก (ปิด = บอทเงียบทั้งหมด ให้เจ้าหน้าที่ตอบเองผ่าน chat.line.biz)'
WHERE "key" = 'messaging_enabled';
