-- Codes of five or six digits sitting in hCode are not หน่วยคุม.
--
-- The cooperative has 64 of them, 1 to 1200, by its own สรุปหน่วยคุม — four
-- digits at most. The longer numbers came from the unit files, whose
-- "รหัสหน่วย" column holds the สังกัด's code (520001, 13003), and every one
-- of them appeared in the dashboard's หน่วยคุม list as a unit that does not
-- exist. lib/sheetColumns.ts now reads such a column as รหัสสังกัด; this
-- moves the rows already imported.
UPDATE "StatementMember"
SET "unitCode" = "hCode", "hCode" = NULL
WHERE "hCode" ~ '^[0-9]{5,}$' AND "unitCode" IS NULL;

-- Where the same code is already recorded as the สังกัด's, there is nothing
-- to move — only the wrong copy to clear.
UPDATE "StatementMember"
SET "hCode" = NULL
WHERE "hCode" ~ '^[0-9]{5,}$' AND "unitCode" = "hCode";

-- A row holding two different long codes is left exactly as it is: one of
-- them is a สังกัด code this cannot choose between, and losing either
-- silently is worse than leaving a visible oddity for somebody to look at.
