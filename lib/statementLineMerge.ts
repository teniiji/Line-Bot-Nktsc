// What a re-uploaded statement should do to the lines already stored.
//
// Statements are exported per date range and those ranges overlap, so most of
// a re-uploaded file is lines that are already here. Deleting them and writing
// them again is right about the data and wrong about identity: a stored line's
// id is what a staff-recorded transaction points at
// (Expense.statementLineId), and deleting the row breaks that pointer
// silently. The transaction then pairs with nothing for the rest of its life,
// its own bank line goes back to reading as money nobody claimed, and the
// unique index that stops the same line being recorded twice no longer
// covers it — so the next person to ring round can file the same ฿10,000 a
// second time.
//
// A line that is already here therefore keeps its row and its id. It is
// rewritten only when something the fingerprint does not cover has actually
// changed, which happens when the parser learns to read a field it used to
// miss — a payer account, say. On an ordinary re-upload nothing changes and
// nothing is written.
//
// sourceFile is deliberately not a reason to rewrite, and not overwritten
// when one happens: it names the upload that first brought the line in, which
// is the more useful of the two answers and the only one that stays true.

// The fields a re-upload can legitimately change. Everything else about a
// line is either in its fingerprint (so a change makes it a different line)
// or not the file's to say.
export interface MergeableLine {
  fingerprint: string;
  branch: string;
  description: string;
  senderAccount: string | null;
  channel: string;
}

export interface StoredLine extends MergeableLine {
  id: string;
}

export interface LineMergePlan<T extends MergeableLine> {
  // Lines the account has never held: written as they are.
  create: T[];
  // Lines already held whose content the file disagrees with. The id is the
  // row that keeps it, so nothing pointing at that row is disturbed.
  update: { id: string; line: T }[];
  // Already held and already correct. Counted rather than dropped, because
  // "the file had 159 lines" is what staff check the upload against, and that
  // number must not depend on how much of it was new.
  unchangedCount: number;
}

const differs = (stored: MergeableLine, line: MergeableLine): boolean =>
  stored.branch !== line.branch ||
  stored.description !== line.description ||
  stored.senderAccount !== line.senderAccount ||
  stored.channel !== line.channel;

export function planLineMerge<T extends MergeableLine>(
  stored: StoredLine[],
  incoming: T[]
): LineMergePlan<T> {
  const byFingerprint = new Map(stored.map((row) => [row.fingerprint, row]));

  const create: T[] = [];
  const update: { id: string; line: T }[] = [];
  let unchangedCount = 0;
  // A file that lists the same line twice would otherwise be planned as two
  // creates and violate the unique index mid-transaction, losing the whole
  // upload. parseStatementLines gives repeated lines different fingerprints
  // through `occurrence`, so this only catches a genuine repeat, but the
  // upload is not the place to find out that it doesn't.
  const planned = new Set<string>();

  for (const line of incoming) {
    if (planned.has(line.fingerprint)) continue;
    planned.add(line.fingerprint);

    const existing = byFingerprint.get(line.fingerprint);
    if (!existing) {
      create.push(line);
    } else if (differs(existing, line)) {
      update.push({ id: existing.id, line });
    } else {
      unchangedCount += 1;
    }
  }

  return { create, update, unchangedCount };
}

// The span of days an upload covers, from the file itself.
//
// Read from the parsed lines rather than back out of the database by
// filename: now that a line already stored keeps the sourceFile it arrived
// with, a file re-uploaded unchanged stamps nothing, and asking the database
// which lines carry this filename would answer "none" for an upload that in
// fact loaded the whole month.
export function postedRange(lines: { postedAt: Date | null }[]): {
  from: Date | null;
  to: Date | null;
} {
  let from: Date | null = null;
  let to: Date | null = null;
  for (const line of lines) {
    if (!line.postedAt) continue;
    if (!from || line.postedAt < from) from = line.postedAt;
    if (!to || line.postedAt > to) to = line.postedAt;
  }
  return { from, to };
}
