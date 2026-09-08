-- Store one member number per member, written one way.
--
-- Member numbers reach this database from four places that write them
-- differently: the หักไม่ได้ sheet, the bank-account spreadsheet, members
-- typing into LINE, and staff typing into the dashboard. Some carry a leading
-- zero and some do not, so one member exists under two spellings.
--
-- #101 taught the daily reconciliation to compare them as members. It could
-- not fix the other half: every lookup in the app asks the database directly
--
--   prisma.memberRoster.findUnique({ where: { memberNumber } })
--
-- and "029262" finds nothing while "29262" is right there. The visible cost is
-- memberVerified — a real member's transactions are filed as unverified,
-- because the roster was asked about a spelling instead of about a member.
--
-- Comparing at every one of those lookups would mean rewriting them all and
-- remembering forever. Storing the number one way instead leaves all of them
-- correct as they are.
--
-- Canonical form matches memberNumberKey in lib/memberNumber.ts exactly:
-- trimmed, leading zeros removed, never reduced to nothing.

CREATE FUNCTION pg_temp.member_number_key(value text) RETURNS text AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    WHEN btrim(value) = '' THEN value
    WHEN btrim(value) ~ '^0+$' THEN '0'
    ELSE ltrim(btrim(value), '0')
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Two members whose numbers differ only by a leading zero cannot both survive
-- a unique index, and which of them is real is not a question this migration
-- can answer. So it stops, names them, and changes nothing — a failed
-- migration a person reads is better than a silent merge of two members'
-- records.
DO $$
DECLARE colliding text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal("memberNumber"), ', ')
    INTO colliding
    FROM "MemberRoster"
   WHERE pg_temp.member_number_key("memberNumber") IN (
     SELECT pg_temp.member_number_key("memberNumber")
       FROM "MemberRoster"
      GROUP BY pg_temp.member_number_key("memberNumber")
     HAVING count(*) > 1
   );

  IF colliding IS NOT NULL THEN
    RAISE EXCEPTION
      'MemberRoster has member numbers that differ only by a leading zero: %. Resolve them by hand first; nothing has been changed.',
      colliding;
  END IF;
END $$;

DO $$
DECLARE colliding text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal("roundId" || ' / ' || "memberNumber"), ', ')
    INTO colliding
    FROM "StatementMember"
   WHERE ("roundId", pg_temp.member_number_key("memberNumber")) IN (
     SELECT "roundId", pg_temp.member_number_key("memberNumber")
       FROM "StatementMember"
      GROUP BY "roundId", pg_temp.member_number_key("memberNumber")
     HAVING count(*) > 1
   );

  IF colliding IS NOT NULL THEN
    RAISE EXCEPTION
      'StatementMember has member numbers in one round that differ only by a leading zero: %. Resolve them by hand first; nothing has been changed.',
      colliding;
  END IF;
END $$;

-- Only rows that actually change are written, so the report a person sees
-- afterwards ("UPDATE 3") is the number of member numbers that were spelled
-- differently, not the size of the tables.
UPDATE "MemberRoster"      SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "StatementMember"   SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "MemberBankAccount" SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "Expense"           SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "LineUser"          SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "ServiceRequestLog" SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");
UPDATE "StatementTransfer" SET "memberNumber" = pg_temp.member_number_key("memberNumber") WHERE "memberNumber" <> pg_temp.member_number_key("memberNumber");

-- memberVerified was decided by a lookup that could not find the member.
-- Re-decided here for the rows the roster now recognises, so the "ยังไม่ยืนยัน"
-- flag stops accusing members who were in the roster all along. Only ever
-- turned on, never off: an unverified row that the roster still does not know
-- stays unverified, which is exactly what the flag is for.
UPDATE "Expense" e
   SET "memberVerified" = true
  FROM "MemberRoster" r
 WHERE e."memberVerified" = false
   AND e."memberNumber" IS NOT NULL
   AND e."memberNumber" = r."memberNumber";
