export const formatAmount = (amount: number) =>
  amount.toLocaleString("th-TH", { style: "currency", currency: "THB" });

// Statement timestamps are stored as the wall clock the bank printed, held in
// UTC (see parseStatementDate), so they are rendered in UTC too. Reading them
// in the viewer's own timezone would slide every date by that offset — a
// transfer on the 31st showing as the 30th on a device set to another
// country, which on a month-end round is the difference between "จ่ายทัน" and
// "จ่ายช้า".
const DATE_PARTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
};

const TIME_PARTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

// Exact midnight means the export gave a date with no clock reading (see
// hasTimeOfDay in statementReconcile). Showing "00:00" there would invent a
// precision the bank never supplied.
const carriesTime = (date: Date) =>
  date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;

export const formatStatementDate = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("th-TH", DATE_PARTS);
};

// The time on its own, for a cell that already shows the date beside it.
// Empty rather than a dash when there is none, so a round whose export
// carried no times doesn't fill a whole column with placeholders.
export const formatStatementTime = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !carriesTime(date)) return "";
  return `${date.toLocaleTimeString("th-TH", TIME_PARTS)} น.`;
};

// The same clock reading with its seconds kept, for the one table that is
// read straight across against the bank's own printout. Everywhere else the
// minute is the useful unit and the seconds are noise; here they are how two
// postings in the same minute are told apart, and how a row is found again in
// the file. Same midnight guard: a export that carried no clock still shows
// nothing rather than inventing "00:00:00".
export const formatStatementTimeExact = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !carriesTime(date)) return "";
  return `${date.toLocaleTimeString("th-TH", { ...TIME_PARTS, second: "2-digit" })} น.`;
};

// Both on one line, for CSV and for places too narrow to stack them.
export const formatStatementDateTime = (iso: string | null): string => {
  const date = formatStatementDate(iso);
  const time = formatStatementTime(iso);
  return time ? `${date} ${time}` : date;
};
