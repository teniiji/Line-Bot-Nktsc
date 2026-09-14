-- Money collected through the cooperative's ถุงเงิน account is a member
-- paying in by QR, but its transaction code (NMPSDP) was not one the parser
-- knew, so every one of these lines was stored as "other" — institutional
-- money, which the daily view never offers to record. A ฿10,500 payment sat
-- in รายการอื่น with no button on it.
--
-- The parser knows the code now (lib/statementLines.ts). This re-classifies
-- the lines already stored, so staff do not have to re-upload a statement to
-- get at them.
--
-- Money out is never a member paying in, whatever the code says — the same
-- rule classifyChannel applies, kept here so the two cannot disagree.
UPDATE "StatementLine"
SET "channel" = 'qr'
WHERE "txnCode" = 'NMPSDP' AND "amount" > 0 AND "channel" = 'other';
