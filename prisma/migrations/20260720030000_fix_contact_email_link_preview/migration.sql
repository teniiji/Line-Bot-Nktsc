-- Fixes an already-seeded value, not a schema change: LINE's client
-- rendered a link-preview card for a gambling site squatting the
-- cooperative's old, expired nktsc.org domain, triggered by the literal
-- substring "nktsc.org" inside the (still correct) contact email address
-- "nktsc.org@gmail.com". A zero-width U+2060 WORD JOINER between "nktsc"
-- and ".org" breaks LINE's link-detection pattern while staying invisible
-- and safe to copy-paste — see lib/knowledge.ts for the matching fallback.
UPDATE "KnowledgeEntry"
SET "content" = 'ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์บริหารสำนักงาน 042-411334, 042-423355, 042420746 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | อีเมล nktsc⁠.org@gmail.com',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'contact';
