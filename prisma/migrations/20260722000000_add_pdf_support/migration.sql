-- Members can send a PDF (not just a photo) as a transfer slip or
-- supporting document. These flags let staff-forwarding code know whether
-- it can push the attachment as a LINE image message (photos only) or must
-- fall back to a plain text link, since LINE's Messaging API can't push
-- file messages.
ALTER TABLE "Expense" ADD COLUMN "slipIsPdf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PendingTransaction" ADD COLUMN "slipIsPdf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PendingServiceRequest" ADD COLUMN "imageIsPdf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServiceRequestLog" ADD COLUMN "imageIsPdf" BOOLEAN NOT NULL DEFAULT false;
