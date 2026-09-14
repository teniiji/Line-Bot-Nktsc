-- Lets staff mark a statement transfer as being for something other than this
-- round's failed deductions (ซื้อหุ้น, ชำระหนี้, ฝากเงิน …). A statement line
-- never says what the money was for, so without this a member who transferred
-- for another purpose reads as having settled a debt they still owe.

ALTER TABLE "StatementTransfer" ADD COLUMN "excludedReason" TEXT;
