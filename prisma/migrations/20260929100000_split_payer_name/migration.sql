-- The name staff give the payer when dividing a line, kept on the division
-- itself: a line whose description is only numbers ("9802889202/10131063")
-- has no key to file a UnitPayer under, and the name was lost.
ALTER TABLE "StatementLineSplit" ADD COLUMN "payerName" TEXT;

-- Divisions made before this recorded the name only in each share's
-- transaction ("แบ่งจากยอด <name> ฿… ที่โอนเข้ามาทีเดียว …").
UPDATE "StatementLineSplit" s
SET "payerName" = sub.name
FROM (
  SELECT DISTINCT ON ("splitFromLineId")
    "splitFromLineId" AS line_id,
    substring("description" from '^แบ่งจากยอด (.+) ฿[0-9,]+\.[0-9]{2} ที่โอนเข้ามาทีเดียว') AS name
  FROM "Expense"
  WHERE "splitFromLineId" IS NOT NULL
  ORDER BY "splitFromLineId", "createdAt" DESC
) sub
WHERE s."lineId" = sub.line_id
  AND sub.name IS NOT NULL
  AND sub.name <> 'หน่วยงาน';
