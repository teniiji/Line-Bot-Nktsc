// Binding a screenful of accounts at once, without binding anything the
// person did not see.
//
// The daily page already knows who many of these accounts belong to — staff
// rang round and recorded the payment there. The round shows the answer on
// each row with a "ใช้เลขนี้" button, and on a list of hundreds that is two
// clicks a row for an answer the system already had.
//
// So the answers can be taken in one go. What must not happen is the person
// approving a list and something else being saved: the page they approved
// may be minutes old, and in between somebody else may have recorded a
// different member against one of those accounts, or corrected one.
//
// The browser therefore sends back exactly the pairs it displayed, the server
// works out the same answers again from the database, and only pairs where
// the two agree are written. The rest are counted and reported rather than
// guessed at — the person can look at those few rows and decide.

export interface ProposedBinding {
  accountNumber: string;
  memberNumber: string;
}

export interface AgreedBindings {
  // Shown, and still true. These get written.
  apply: ProposedBinding[];
  // Shown, but the database no longer says this — changed or withdrawn since
  // the page was drawn. Left alone, and reported.
  stale: ProposedBinding[];
}

// Keeps only the bindings the server can still vouch for.
//
// `truth` is the server's own answer per account, derived the same way the
// row was: the most recent recording naming a member. An account missing
// from it is one nobody has recorded any more.
export function agreedBindings(
  proposed: ProposedBinding[],
  truth: Map<string, string>
): AgreedBindings {
  const apply: ProposedBinding[] = [];
  const stale: ProposedBinding[] = [];
  // One account can carry several transfers, and the browser sends a pair per
  // row. Writing the same binding repeatedly is harmless but the counts staff
  // read would be wrong — "ผูกให้ 12 บัญชี" for four.
  const seen = new Set<string>();

  for (const pair of proposed) {
    if (seen.has(pair.accountNumber)) continue;
    seen.add(pair.accountNumber);
    if (truth.get(pair.accountNumber) === pair.memberNumber) apply.push(pair);
    else stale.push(pair);
  }

  return { apply, stale };
}
