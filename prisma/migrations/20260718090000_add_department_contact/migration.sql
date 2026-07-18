-- CreateTable
CREATE TABLE "DepartmentContact" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepartmentContact_department_idx" ON "DepartmentContact"("department");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentContact_department_lineUserId_key" ON "DepartmentContact"("department", "lineUserId");
