import { describe, expect, it } from "vitest";
import {
  calcPaymentStatus,
  extractTransferAccount,
  hasTimeOfDay,
  matchTransfers,
  normalizeAccountNumber,
  parseAmount,
  parseMaiDaiSheet,
  pickUnitNameColumn,
  parseStatementDate,
  parseStatementRows,
  transferFingerprint,
} from "../lib/statementReconcile";

describe("normalizeAccountNumber", () => {
  it("keeps digits from whatever shape Excel stored the account in", () => {
    expect(normalizeAccountNumber("0431234567")).toBe("0431234567");
    expect(normalizeAccountNumber(4312345670)).toBe("4312345670");
    expect(normalizeAccountNumber("4312345670.0")).toBe("4312345670");
    expect(normalizeAccountNumber("043-1-23456-7")).toBe("0431234567");
    expect(normalizeAccountNumber("  ")).toBeNull();
    expect(normalizeAccountNumber(null)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads amounts written with separators", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount(980)).toBe(980);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("ไม่ใช่ตัวเลข")).toBeNull();
  });
});

describe("parseStatementDate", () => {
  it("converts Buddhist-era years to Gregorian", () => {
    expect(parseStatementDate("25/06/2569")?.toISOString().slice(0, 10)).toBe("2026-06-25");
  });

  it("repairs a missing separator between day and year", () => {
    expect(parseStatementDate("25/062569")?.toISOString().slice(0, 10)).toBe("2026-06-25");
  });

  it("leaves an already-Gregorian date alone", () => {
    expect(parseStatementDate("25/06/2026")?.toISOString().slice(0, 10)).toBe("2026-06-25");
  });

  it("rejects impossible or empty dates rather than inventing one", () => {
    expect(parseStatementDate("32/13/2569")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
    expect(parseStatementDate(null)).toBeNull();
  });

  it("keeps the time of day when the export carries one", () => {
    expect(parseStatementDate("31/08/2569 14:32")?.toISOString()).toBe("2026-08-31T14:32:00.000Z");
    expect(parseStatementDate("31/08/2569 14:32:07")?.toISOString()).toBe(
      "2026-08-31T14:32:07.000Z"
    );
    expect(parseStatementDate("31/08/2569T09:05")?.toISOString()).toBe("2026-08-31T09:05:00.000Z");
  });

  it("keeps the date when there is no time to read", () => {
    expect(parseStatementDate("31/08/2569")?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("ignores a trailing number that is not a clock reading", () => {
    // The bank puts a teller id and a running balance next to the date; none
    // of them may be mistaken for a time.
    expect(parseStatementDate("31/08/2569 44:99")?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(parseStatementDate("31/08/2569 1234567")?.toISOString()).toBe(
      "2026-08-31T00:00:00.000Z"
    );
  });
});

describe("hasTimeOfDay", () => {
  it("treats exact midnight as a date with no clock reading", () => {
    expect(hasTimeOfDay(new Date("2026-08-31T00:00:00.000Z"))).toBe(false);
    expect(hasTimeOfDay(new Date("2026-08-31T14:32:00.000Z"))).toBe(true);
    expect(hasTimeOfDay(new Date("2026-08-31T00:00:30.000Z"))).toBe(true);
  });
});

describe("extractTransferAccount", () => {
  it("picks the account out of a TR fr line", () => {
    expect(extractTransferAccount("TR fr 0431234567")).toBe("0431234567");
    expect(extractTransferAccount("X/TR FR 4470001111 SOMETHING")).toBe("4470001111");
  });

  it("ignores statement lines that are not member transfers", () => {
    expect(extractTransferAccount("BSD14 NONGKHAI PRIMA")).toBeNull();
    expect(extractTransferAccount("SDTRC GFMIS")).toBeNull();
    expect(extractTransferAccount("BEF BAL")).toBeNull();
    expect(extractTransferAccount(null)).toBeNull();
  });
});

describe("parseMaiDaiSheet", () => {
  const rows: unknown[][] = [
    ["12345", "สมชาย ใจดี", 5000, 5000, 0, "สพป.นค เขต 1", null, "1234567890123", "0431234567", "7"],
    ["12346", "สมหญิง มีสุข", 5000, 2000, 3000, "สพป.นค เขต 1", "ขอผ่อน", "1234567890124", "0431234568", "7"],
    ["12347", "วิชัย ตั้งใจ", 4000, 0, 4000, "สพม.บึงกาฬ", null, "1234567890125", 4470001111, "20"],
    ["", "แถวว่าง", null, null, null, null, null, null, null, null],
  ];

  it("keeps only members who actually have an outstanding amount", () => {
    const { rows: parsed } = parseMaiDaiSheet(rows);
    expect(parsed.map((r) => r.memberNumber)).toEqual(["12346", "12347"]);
  });

  it("reads the fields matching is built on", () => {
    const [first, second] = parseMaiDaiSheet(rows).rows;
    expect(first).toMatchObject({
      memberNumber: "12346",
      name: "สมหญิง มีสุข",
      unitName: "สพป.นค เขต 1",
      note: "ขอผ่อน",
      accountNumber: "0431234568",
      hCode: "7",
      amountDue: 3000,
    });
    expect(second.accountNumber).toBe("4470001111");
  });

  it("does not copy national ID numbers out of the sheet", () => {
    const serialized = JSON.stringify(parseMaiDaiSheet(rows).rows);
    expect(serialized).not.toContain("1234567890124");
  });

  // The 0869 sheet puts a numeric หน่วยงาน code in F — the same value as the
  // H-code in J — and the real name in G. Reading a fixed column showed a
  // bare "1" as สังกัด and pushed the school name into หมายเหตุ.
  it("takes สังกัด from whichever column holds names, not a fixed position", () => {
    const codeInF: unknown[][] = [
      ["28590", "นายเสกสิน ศรีปากดี", 30700, 26440, 4260, "75", "ร.ร.บ้านหนองเดิ่น", "2461400016234", null, "75"],
    ];
    const [member] = parseMaiDaiSheet(codeInF).rows;
    expect(member.unitName).toBe("ร.ร.บ้านหนองเดิ่น");
    expect(member.hCode).toBe("75");
    // Nothing is left to be a หมายเหตุ once G is the unit name — repeating
    // the code there would just be noise beside the member's name.
    expect(member.note).toBeNull();
  });

  it("stores the member number the one way the rest of the system uses", () => {
    // This sheet is where "29262" came from while the member's own slip said
    // "029262", and the two spellings made the daily reconciliation read one
    // member as two. Canonical from the moment it is read.
    const padded: unknown[][] = [
      ["029262", "นางสาวภรณ์ทิพย์ เข็มศิริ", 4200, 0, 4200, "1", "ร.ร. ก", null, null, "1"],
    ];
    expect(parseMaiDaiSheet(padded).rows[0].memberNumber).toBe("29262");
  });

  it("separates units awaiting a result from members who paid in full", () => {
    const mixed: unknown[][] = [
      // Reported and collected everything: not outstanding, not awaited.
      ["29001", "หักได้ครบ", 5000, 5000, 0, "1", "ร.ร. ก", null, null, "1"],
      // Reported, still short.
      ["29002", "ยังค้าง", 5000, 2000, 3000, "1", "ร.ร. ก", null, null, "1"],
      // No result at all — the unit has not reported back.
      ["29003", "รอผล", 4000, null, null, "2", "ร.ร.จ่ายตรง ข", null, null, "2"],
      ["29004", "รอผล", 6000, null, null, "2", "ร.ร.จ่ายตรง ข", null, null, "2"],
      ["29005", "รอผล", 1000, null, null, "3", "บำนาญ ค", null, null, "3"],
    ];
    const sheet = parseMaiDaiSheet(mixed);

    expect(sheet.rows.map((r) => r.memberNumber)).toEqual(["29002"]);
    expect(sheet.awaitingMembers).toBe(3);
    expect(sheet.awaitingAmount).toBe(11000);
    // Counted by หน่วยคุม (H-code 2 and 3), matching how the cooperative’s own
    // summary sheet groups units.
    expect(sheet.awaitingUnits).toEqual(["2", "3"]);
  });

  it("treats a zero result as collected, not as awaiting", () => {
    const zero: unknown[][] = [["001", "หักได้ครบ", 5000, 5000, 0, "1", "ร.ร. ก", null, null, "1"]];
    const sheet = parseMaiDaiSheet(zero);
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.awaitingMembers).toBe(0);
  });
});

describe("pickUnitNameColumn", () => {
  it("prefers the column of names over a column of codes", () => {
    const rows: unknown[][] = [
      ["1", "ชื่อ", 0, 0, 0, "75", "ร.ร.บ้านหนองเดิ่น"],
      ["2", "ชื่อ", 0, 0, 0, "76", "ร.ร.บ้านโนนสวรรค์"],
    ];
    expect(pickUnitNameColumn(rows)).toBe(6);
  });

  it("still finds สังกัด in F when that is where the names are", () => {
    const rows: unknown[][] = [
      ["1", "ชื่อ", 0, 0, 0, "สพป.นค เขต 1", "ขอผ่อน"],
      ["2", "ชื่อ", 0, 0, 0, "สพป.นค เขต 1", null],
    ];
    expect(pickUnitNameColumn(rows)).toBe(5);
  });

  it("gives up rather than guessing when neither column holds names", () => {
    const rows: unknown[][] = [["1", "ชื่อ", 0, 0, 0, "75", "75"]];
    expect(pickUnitNameColumn(rows)).toBeNull();
  });
});

describe("parseStatementRows", () => {
  it("keeps only TR fr rows, skipping the export's preamble and other postings", () => {
    const rows: unknown[][] = [
      ["บัญชี", null, null, null, null, null],
      ["Date", "Teller Id", "Txn Code", "Description", "Cheque No.", "Amount"],
      ["25/06/2569", "T1", "TR", "TR fr 0431234568", null, "3,000.00"],
      ["26/06/2569", "T2", "BS", "BSD14 NONGKHAI PRIMA", null, "120000"],
      ["26/06/2569", "T3", "TR", "TR fr 4470001111", null, 2000],
      ["26/06/2569", "T4", "IN", "ดอกเบี้ย", null, 12.5],
    ];
    const parsed = parseStatementRows(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ accountNumber: "0431234568", amount: 3000 });
    expect(parsed[0].transferredAt?.toISOString().slice(0, 10)).toBe("2026-06-25");
    expect(parsed[1]).toMatchObject({ accountNumber: "4470001111", amount: 2000 });
  });

  it("numbers otherwise identical lines so they stay separate transfers", () => {
    // Same payer, same amount, same day, and no balance column to tell them
    // apart — two real payments, not one line read twice.
    const rows: unknown[][] = [
      ["25/06/2569", "T1", "TR", "TR fr 0431234568", null, 500],
      ["25/06/2569", "T2", "TR", "TR fr 0431234568", null, 500],
    ];
    const parsed = parseStatementRows(rows);
    expect(parsed.map((t) => t.occurrence)).toEqual([0, 1]);
    expect(transferFingerprint("413", parsed[0])).not.toBe(
      transferFingerprint("413", parsed[1])
    );
  });

  it("reads the running balance, which separates same-day repeat payments", () => {
    const rows: unknown[][] = [
      ["25/06/2569", "T1", "TR", "TR fr 0431234568", null, 500, null, 10500],
      ["25/06/2569", "T2", "TR", "TR fr 0431234568", null, 500, null, 11000],
    ];
    const parsed = parseStatementRows(rows);
    expect(parsed.map((t) => t.balance)).toEqual([10500, 11000]);
    expect(parsed.map((t) => t.occurrence)).toEqual([0, 0]);
    expect(transferFingerprint("413", parsed[0])).not.toBe(
      transferFingerprint("413", parsed[1])
    );
  });
});

describe("transferFingerprint", () => {
  const statement = (rows: unknown[][]) => parseStatementRows(rows);
  const line = (date: string, acct: string, amount: number, balance?: number) =>
    [date, "T", "TR", `TR fr ${acct}`, null, amount, null, balance] as unknown[];

  it("gives a statement line the same identity every time it is uploaded", () => {
    const first = statement([line("25/06/2569", "0431234568", 3000, 10000)]);
    const again = statement([line("25/06/2569", "0431234568", 3000, 10000)]);
    expect(transferFingerprint("413", first[0])).toBe(transferFingerprint("413", again[0]));
  });

  it("is unchanged by the time of day, so rounds loaded before times were read still match", () => {
    // Reading the clock reading out of the export must not re-identify lines
    // that are already in the database: if it did, re-uploading a statement
    // would insert every row a second time and double the money.
    const withoutTime = statement([line("25/06/2569", "0431234568", 3000, 10000)]);
    const withTime = statement([line("25/06/2569 14:32", "0431234568", 3000, 10000)]);
    expect(withTime[0].transferredAt?.toISOString()).toBe("2026-06-25T14:32:00.000Z");
    expect(transferFingerprint("413", withTime[0])).toBe(
      transferFingerprint("413", withoutTime[0])
    );
  });

  it("recognises the shared days between two overlapping date ranges", () => {
    // 1-15 uploaded, then 1-30: the first half must be recognised, so only
    // the later lines are new.
    const firstHalf = statement([
      line("05/06/2569", "0431234568", 1000, 5000),
      line("10/06/2569", "4470001111", 2000, 7000),
    ]);
    const wholeMonth = statement([
      line("05/06/2569", "0431234568", 1000, 5000),
      line("10/06/2569", "4470001111", 2000, 7000),
      line("25/06/2569", "0431234569", 1500, 8500),
    ]);

    const known = new Set(firstHalf.map((t) => transferFingerprint("413", t)));
    const incoming = wholeMonth.map((t) => transferFingerprint("413", t));
    expect(incoming.filter((f) => known.has(f))).toHaveLength(2);
    expect(incoming.filter((f) => !known.has(f))).toHaveLength(1);
  });

  it("keeps the same line distinct between the two bank accounts", () => {
    const parsed = statement([line("25/06/2569", "0431234568", 3000, 10000)]);
    expect(transferFingerprint("413", parsed[0])).not.toBe(
      transferFingerprint("447", parsed[0])
    );
  });

  it("separates two transfers that differ only by date, amount or payer", () => {
    const base = statement([line("25/06/2569", "0431234568", 3000, 10000)])[0];
    const otherDay = statement([line("26/06/2569", "0431234568", 3000, 10000)])[0];
    const otherAmount = statement([line("25/06/2569", "0431234568", 3500, 10000)])[0];
    const otherPayer = statement([line("25/06/2569", "4470001111", 3000, 10000)])[0];

    const prints = [base, otherDay, otherAmount, otherPayer].map((t) =>
      transferFingerprint("413", t)
    );
    expect(new Set(prints).size).toBe(4);
  });
});

describe("calcPaymentStatus", () => {
  it("marks an exact payment as paid", () => {
    expect(calcPaymentStatus(3000, 3000)).toEqual({ status: "paid", diff: 0 });
  });

  it("marks more than owed as overpaid, less as still owing", () => {
    expect(calcPaymentStatus(3500, 3000)).toEqual({ status: "overpaid", diff: 500 });
    expect(calcPaymentStatus(1000, 3000)).toEqual({ status: "unpaid", diff: -2000 });
  });

  it("treats no payment at all as still owing", () => {
    expect(calcPaymentStatus(0, 3000)).toEqual({ status: "unpaid", diff: -3000 });
  });

  it("does not report a rounding remainder as an overpayment", () => {
    expect(calcPaymentStatus(0.1 + 0.2, 0.3).status).toBe("paid");
  });
});

describe("matchTransfers", () => {
  const members = [
    { memberNumber: "12346", accountNumber: "0431234568" },
    { memberNumber: "12347", accountNumber: "4470001111" },
    { memberNumber: "12348", accountNumber: null },
  ];

  it("adds up instalments and keeps the latest transfer date", () => {
    const { matchedByMember } = matchTransfers(
      [
        {
          accountNumber: "0431234568",
          amount: 1000,
          transferredAt: new Date("2026-06-10"),
          description: "TR fr 0431234568",
        },
        {
          accountNumber: "0431234568",
          amount: 2000,
          transferredAt: new Date("2026-06-20"),
          description: "TR fr 0431234568",
        },
      ],
      members
    );
    expect(matchedByMember.get("12346")).toEqual({
      amountPaid: 3000,
      paidAt: new Date("2026-06-20"),
    });
  });

  it("reports money that belongs to nobody on the list instead of dropping it", () => {
    const { matchedByMember, unmatched } = matchTransfers(
      [
        {
          accountNumber: "9999999999",
          amount: 500,
          transferredAt: null,
          description: "TR fr 9999999999",
        },
      ],
      members
    );
    expect(matchedByMember.size).toBe(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].accountNumber).toBe("9999999999");
  });

  it("never matches a member who has no account number on file", () => {
    const { unmatched } = matchTransfers(
      [{ accountNumber: "", amount: 100, transferredAt: null, description: "TR fr " }],
      members
    );
    expect(unmatched).toHaveLength(1);
  });
});
