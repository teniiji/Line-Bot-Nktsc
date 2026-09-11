// One clock for the whole system: the one on the wall in the cooperative's
// office.
//
// A transaction carries a date, and until now that date could mean two
// different things depending on who wrote it:
//
//   * a bank line, and any payment staff recorded from one, holds the wall
//     clock the bank printed, kept in UTC (see parseStatementDate) — 06:30 on
//     the statement is stored as 06:30Z and rendered back as 06:30
//   * a slip the bot logged held the real instant it was logged at, so a
//     payment filed at 02:00 in the morning in Nong Khai was stored as 19:00
//     the previous day
//
// Every day boundary in the system is read in UTC, so the second kind landed
// on the wrong day: a member who sent a slip after midnight had it counted
// against yesterday on the transaction list, in the daily reconciliation, in
// the month's totals, and in what the bot itself said back to them. Thailand
// is seven hours ahead of UTC, so this is every transaction filed between
// midnight and seven in the morning — which, for a bot that answers at any
// hour, is not a rare corner.
//
// The fix is not to teach every reader about two clocks. It is to write only
// one, and the bank's convention wins because the statement is the record
// staff read across from: a transaction's date now holds Thai wall clock in
// UTC, whoever wrote it, and every existing reader — the filters, the daily
// view, the totals, the UTC-rendered date columns — is then already right.
//
// Thailand has one timezone and has had no daylight saving since 1955, so the
// offset is a constant rather than a timezone database lookup. That is a
// deliberate simplification and it holds for this cooperative: the office, the
// bank, the members and the staff are all in Nong Khai and Bueng Kan.

export const COOPERATIVE_OFFSET_MS = 7 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Now, as the cooperative's wall clock, held in UTC — the same shape every
 * statement timestamp has. This is what a transaction's date is written with.
 */
export function cooperativeNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + COOPERATIVE_OFFSET_MS);
}

/**
 * Today's date in Thailand, as YYYY-MM-DD.
 *
 * Deliberately not the device's own idea of today: staff open the dashboard
 * from phones and laptops whose clocks are set to whatever they are set to,
 * and "วันนี้" has to mean the cooperative's today on all of them.
 */
export function cooperativeToday(now: Date = new Date()): string {
  return cooperativeNow(now).toISOString().slice(0, 10);
}

/** The instant a Thai calendar day begins, as a wall-clock Date. */
export function dayStart(day: string): Date | null {
  const start = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/**
 * A day, some days later or earlier. Kept as string arithmetic through UTC so
 * month ends and leap days come out right without a calendar library.
 *
 * An unreadable day is handed back untouched: a date the user cannot have
 * typed is not worth turning into an Invalid Date further down.
 */
export function shiftDay(day: string, days: number): string {
  const start = dayStart(day);
  if (!start) return day;
  return new Date(start.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first day of the month a day falls in. */
export function startOfMonth(day: string): string {
  return dayStart(day) ? `${day.slice(0, 7)}-01` : day;
}

/** The last day of the month a day falls in — 28, 29, 30 or 31. */
export function endOfMonth(day: string): string {
  const start = dayStart(startOfMonth(day));
  if (!start) return day;
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * The month a day falls in, as the half-open window [start, end) that a
 * database query wants.
 */
export function monthWindow(day: string): { start: Date; end: Date } | null {
  const start = dayStart(startOfMonth(day));
  if (!start) return null;
  const end = dayStart(shiftDay(endOfMonth(day), 1));
  return end ? { start, end } : null;
}
