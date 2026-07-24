-- Seed two more reference entries sourced from a review of the LINE OA FAQ
-- extract: cooperative account numbers/deadline for ยอดหักไม่ได้ payments,
-- and general loan-eligibility criteria. Kept in sync with DEFAULT_KNOWLEDGE
-- in lib/knowledge.ts.
INSERT INTO "KnowledgeEntry" ("id", "key", "title", "content", "sortOrder", "updatedAt") VALUES
  ('know_mai_dai_payment', 'mai_dai_payment', 'ช่องทางชำระยอดหักไม่ได้', 'โอนเข้าบัญชีสหกรณ์ได้โดยตรง — กรุงไทย หนองคาย 413-1-00127-6 / บึงกาฬ 447-0-32262-8 — ภายในวันที่ 31 ของเดือน ไม่เกิน 15.00 น.', 5, CURRENT_TIMESTAMP),
  ('know_loan_eligibility', 'loan_eligibility', 'เกณฑ์พิจารณาสิทธิ์กู้เงิน', 'วงเงิน/สิทธิ์กู้ทุกประเภทขึ้นอยู่กับเงินเดือนคงเหลือของผู้กู้เป็นหลัก | กู้ดำรงชีพ ใช้สลิปเงินเดือนย้อนหลัง 3 เดือนประกอบพิจารณา | กู้ปิดกรุงไทย พิจารณาจากเงินเดือนคงเหลือ + ยอดหนี้กรุงไทยคงเหลือ (ตัวเลขวงเงินอนุมัติจริงต้องให้เจ้าหน้าที่ตรวจสอบในระบบเสมอ)', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
