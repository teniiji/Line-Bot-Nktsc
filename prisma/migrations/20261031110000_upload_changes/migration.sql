-- What a ผลการหัก upload changed, so it can be taken back out (lib/uploadUndo.ts).
ALTER TABLE "StatementFileUpload" ADD COLUMN "changes" JSONB;
