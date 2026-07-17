-- AlterTable
ALTER TABLE "MemberRoster" ADD COLUMN "responsibleCode" TEXT;

-- CreateTable
CREATE TABLE "ResponsibleContact" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibleContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibleContact_code_key" ON "ResponsibleContact"("code");
