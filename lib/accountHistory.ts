// Finding a member's bank account in what the cooperative already knows.
//
// A round's own sheet can carry เลขบัญชี, and for years that was the only
// place it went: into that round's member row, and nowhere else. The account
// directory holds only what staff bound by hand or imported deliberately — so
// a member whose account number sat in August's file, in a column September's
// file does not even have, reads as "ไม่มีเลขบัญชี" this month. The
// cooperative knew. The round could not see it.
//
// So a blank is filled from two places, in this order:
//
//   1. the directory, when it knows exactly one account for that member —
//      a binding somebody made deliberately is the better answer
//   2. failing that, the most recent earlier round that carried one
//
// Two accounts and no way to choose is not a fill. It is reported instead,
// because "we know two and picked one" is how money ends up matched to the
// wrong half of somebody's banking.

export interface DirectoryEntry {
  memberNumber: string;
  accountNumber: string;
}

export interface HistoricAccount {
  memberNumber: string;
  accountNumber: string;
  // Higher is more recent. The caller ranks the rounds; this only compares.
  rank: number;
}

export interface AccountFill {
  memberNumber: string;
  accountNumber: string;
  source: "directory" | "previous";
}

export interface FilledAccounts {
  fills: AccountFill[];
  // Members where more than one account was on offer with nothing to choose
  // between them. Left blank on purpose, and counted so the page can say so
  // rather than showing the same "ไม่มีเลขบัญชี" as a member nobody knows.
  ambiguous: string[];
}

export function fillAccounts(
  blanks: string[],
  directory: DirectoryEntry[],
  history: HistoricAccount[]
): FilledAccounts {
  const byMember = new Map<string, Set<string>>();
  for (const entry of directory) {
    const set = byMember.get(entry.memberNumber) ?? new Set<string>();
    set.add(entry.accountNumber);
    byMember.set(entry.memberNumber, set);
  }

  // Only the most recent round that knew anything about a member is
  // consulted: an account they have since closed is not a better answer for
  // having been true longer.
  const newest = new Map<string, { rank: number; accounts: Set<string> }>();
  for (const entry of history) {
    const held = newest.get(entry.memberNumber);
    if (!held || entry.rank > held.rank) {
      newest.set(entry.memberNumber, { rank: entry.rank, accounts: new Set([entry.accountNumber]) });
    } else if (entry.rank === held.rank) {
      held.accounts.add(entry.accountNumber);
    }
  }

  const fills: AccountFill[] = [];
  const ambiguous: string[] = [];

  for (const memberNumber of blanks) {
    const bound = byMember.get(memberNumber);
    if (bound && bound.size === 1) {
      fills.push({ memberNumber, accountNumber: [...bound][0], source: "directory" });
      continue;
    }
    if (bound && bound.size > 1) {
      ambiguous.push(memberNumber);
      continue;
    }

    const earlier = newest.get(memberNumber);
    if (!earlier) continue;
    if (earlier.accounts.size > 1) {
      ambiguous.push(memberNumber);
      continue;
    }
    fills.push({ memberNumber, accountNumber: [...earlier.accounts][0], source: "previous" });
  }

  return { fills, ambiguous };
}
