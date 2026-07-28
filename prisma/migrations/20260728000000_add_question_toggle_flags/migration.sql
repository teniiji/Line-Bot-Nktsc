-- Per-question toggles for the transaction-recording flow — lets staff skip
-- a specific follow-up question (e.g. stop asking for loan type) without
-- turning off transaction logging entirely via transactions_enabled.
-- Kept in sync with DEFAULT_FLAGS in lib/featureFlags.ts.
INSERT INTO "FeatureFlag" ("id", "key", "label", "enabled", "updatedAt") VALUES
  ('flag_ask_member_info_enabled', 'ask_member_info_enabled', 'ถามชื่อ-เลขสมาชิก ตอนบันทึกธุรกรรม (ปิด = บันทึกได้แม้ยังไม่ทราบตัวตน)', true, CURRENT_TIMESTAMP),
  ('flag_ask_category_enabled', 'ask_category_enabled', 'ถามประเภทธุรกรรม ตอนสลิปไม่ได้ระบุจุดประสงค์', true, CURRENT_TIMESTAMP),
  ('flag_ask_loan_type_enabled', 'ask_loan_type_enabled', 'ถามประเภทเงินกู้ ตอนบันทึกชำระหนี้', true, CURRENT_TIMESTAMP),
  ('flag_ask_deposit_account_enabled', 'ask_deposit_account_enabled', 'ถามเลขที่บัญชี ตอนบันทึกฝากเงิน', true, CURRENT_TIMESTAMP),
  ('flag_ask_confirm_sender_name_enabled', 'ask_confirm_sender_name_enabled', 'ถามยืนยันชื่อผู้โอน ตอนชื่อในสลิปไม่ตรงกับชื่อสมาชิก', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
