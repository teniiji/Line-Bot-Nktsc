// Which unit a bank line is from.
//
// A unit is recognised by its statement wording (payerKey in lib/unitPayer.ts),
// but the bank cuts that wording short: every สพม. office reads "THE SECONDARY
// /สนง.เขตพื้นที่การศึกษามัธ", the province gone. With one unit per wording,
// สพม.หนองคาย and สพม.กาฬสินธุ์ were the same record — renaming one renamed
// the other, and their members were mixed on one list.
//
// So several units may share a wording, and a line whose wording is shared is
// never guessed: it names its unit when staff have chosen one for it (or
// divided it under one), and otherwise asks — the daily page puts a chooser on
// it every time. A wording only one unit has needs no choice, as before.

export interface PayerRef {
  id: string;
  name: string;
}

export interface LinePayer {
  // The unit this line is from, when that is known.
  payer: PayerRef | null;
  // Every unit sharing the line's wording, when more than one does — what
  // the chooser offers. Empty when the wording is one unit's alone.
  choices: PayerRef[];
}

export function payersByKey(payers: { id: string; key: string; name: string }[]): Map<string, PayerRef[]> {
  const out = new Map<string, PayerRef[]>();
  for (const p of payers) out.set(p.key, [...(out.get(p.key) ?? []), { id: p.id, name: p.name }]);
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, "th"));
  return out;
}

export function resolveLinePayer(candidates: PayerRef[], chosenId: string | null): LinePayer {
  const chosen = chosenId ? (candidates.find((c) => c.id === chosenId) ?? null) : null;
  const shared = candidates.length > 1;
  return {
    payer: chosen ?? (shared ? null : (candidates[0] ?? null)),
    choices: shared ? candidates : [],
  };
}

// The unit a name typed for a line means, among those sharing its wording —
// so dividing a shared line under "สพม.กาฬสินธุ์" files it there rather than
// renaming whichever unit came first. Compared without spacing or case.
export function payerNamed(candidates: PayerRef[], name: string): PayerRef | null {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const wanted = norm(name);
  if (!wanted) return null;
  return candidates.find((c) => norm(c.name) === wanted) ?? null;
}
