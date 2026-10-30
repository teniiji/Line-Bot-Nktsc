// Rows pasted from a list of bank accounts and amounts — the file a Direct
// Debit was sent from, or the bank's CTF001 report of what it collected.
//
// 29/10/2569: the cooperative debited 25 members' Krungthai accounts for
// what payroll could not take, 20 went through, and the bank paid it in as
// one line of ฿126,900 — "ออมทรัพย์ครูฯ - 2352639". Neither paper names a
// member number, only the account and the account holder's name, so each
// of the 20 had to be found by searching a name that the bank spells its
// own way. The account is what both sides share.
//
// Cells arrive tab-separated from Excel, or space-separated from a PDF.
// What decides a cell is its shape, not its column: a 10-digit run is the
// account, a money figure after it is the amount, Thai text is the name.

export interface DebitRow {
  account: string;
  amount: number;
  name: string | null;
}

export interface DebitPaste {
  rows: DebitRow[];
  // Lines with something on them that did not read as an account and an
  // amount: headings, totals, a branch banner.
  skipped: number;
}

// KTB accounts are ten digits. Shorter runs are item numbers, branch codes
// and service codes; longer ones are national IDs.
const ACCOUNT = /^\d{10}$/;
const MONEY = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

const cellsOf = (line: string): string[] =>
  line.includes("\t")
    ? line.split("\t").map((c) => c.trim())
    : line.split(/\s{2,}|\s(?=\d)|(?<=\d)\s/).map((c) => c.trim());

export function parseDebitPaste(text: string): DebitPaste {
  const rows: DebitRow[] = [];
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = cellsOf(line).filter(Boolean);
    // "4,130,003,992" or "413-0-00399-2" are still the account.
    const accountAt = cells.findIndex((c) => ACCOUNT.test(c.replace(/[-,\s]/g, "")) && !c.includes("."));
    if (accountAt < 0) {
      skipped += 1;
      continue;
    }
    const account = cells[accountAt].replace(/\D/g, "");

    // The first figure written as money (4,000.00) — on the bank's report
    // the cells before it are service codes like "14" — or else the only
    // number after the account, as in a plain Excel list.
    const after = cells.slice(accountAt + 1).filter((c) => MONEY.test(c));
    const amountCell =
      after.find((c) => /\.\d{2}$/.test(c)) ??
      after.find((c) => Number(c.replace(/,/g, "")) >= 100) ??
      cells.slice(0, accountAt).reverse().find((c) => MONEY.test(c) && /[.,]/.test(c));
    const amount = amountCell ? Number(amountCell.replace(/,/g, "")) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped += 1;
      continue;
    }

    const name =
      cells
        .filter((c) => /[฀-๿]/.test(c))
        .map((c) => c.replace(/\s+/g, " "))[0] ?? null;
    rows.push({ account, amount: Math.round(amount * 100) / 100, name });
  }

  return { rows, skipped };
}
