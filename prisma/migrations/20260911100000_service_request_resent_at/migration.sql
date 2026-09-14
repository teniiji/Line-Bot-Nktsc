-- When staff last sent a service request to the officer again from the
-- dashboard. Nullable: every row already written was never resent, and most
-- never need to be. Kept apart from createdAt so a row that now reads
-- "ส่งต่อสำเร็จ" still says when the member actually asked.
ALTER TABLE "ServiceRequestLog" ADD COLUMN "resentAt" TIMESTAMP(3);
