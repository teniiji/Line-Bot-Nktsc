-- One clock for a transaction's date.
--
-- A payment staff recorded from a bank line holds the wall clock the bank
-- printed, kept in UTC. A slip the bot logged held the real instant it was
-- logged at — seven hours behind the clock in the office — so every slip
-- filed between midnight and seven in the morning sat on the previous day in
-- the transaction list, in the daily reconciliation and in the month's
-- totals. From now on the bot writes the cooperative's wall clock like
-- everything else (see lib/cooperativeClock.ts); this brings the rows it
-- already wrote onto the same clock.
--
-- Only the bot's own rows are shifted, and "lineUserId IS NOT NULL" is
-- exactly those: the manual form and the record-from-statement route never
-- set it, and both of them already wrote a wall clock.
--
-- A handful of those rows carry a date the model supplied as a plain day
-- (midnight, no clock), and this moves them to 07:00 on that same day. The
-- day is what every reader uses and the day does not change; nothing renders
-- the clock of a transaction.
UPDATE "Expense"
SET "date" = "date" + INTERVAL '7 hours'
WHERE "lineUserId" IS NOT NULL;

-- The unfinished ones the bot is still collecting, for the same reason: one
-- of these becomes an Expense the moment the member answers the last
-- question, and it carries this date with it.
UPDATE "PendingTransaction"
SET "date" = "date" + INTERVAL '7 hours'
WHERE "date" IS NOT NULL;
