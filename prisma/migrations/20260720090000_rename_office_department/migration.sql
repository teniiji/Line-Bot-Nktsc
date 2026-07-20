-- Renames the "บริการสำนักงาน" department to "บริหารสำนักงาน/ธุรการ" —
-- not a schema change, but the two officers already registered under the
-- old name (see DepartmentContact) would silently stop matching once
-- lib/departments.ts's DEPARTMENTS list and the Claude tool schema switch
-- to the new name, since routing matches on the literal department string.
UPDATE "DepartmentContact"
SET "department" = 'บริหารสำนักงาน/ธุรการ'
WHERE "department" = 'บริการสำนักงาน';
