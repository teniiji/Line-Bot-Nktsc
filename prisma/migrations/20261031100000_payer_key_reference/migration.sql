-- payerKey (lib/unitPayer.ts) now leaves out a reference number written after
-- a dash at the end of a segment ("ออมทรัพย์ครูฯ - 2352639" → "ออมทรัพย์ครูฯ"),
-- so a Direct Debit is the same payer every month. Keys stored before that
-- carry the number and would match no new line; they are brought into line.
UPDATE "UnitPayer"
SET "key" = regexp_replace("key", '\s*-\s*[0-9]{4,}(/|$)', '\1', 'g')
WHERE "key" ~ '\s*-\s*[0-9]{4,}(/|$)';
