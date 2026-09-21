-- รหัสหน่วยสังกัด (คอลัมน์ D ของไฟล์รวม): the code of the school or office a
-- member belongs to, which is finer than the หน่วยคุม already stored in
-- hCode. Until now the two were read as one thing and this column had
-- nowhere to go, so a round knew the สังกัด only by its name.
ALTER TABLE "StatementMember" ADD COLUMN "unitCode" TEXT;
