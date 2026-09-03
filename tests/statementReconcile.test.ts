import { describe, expect, it } from "vitest";
import {
  calcPaymentStatus,
  extractTransferAccount,
  matchTransfers,
  normalizeAccountNumber,
  parseAmount,
  parseMaiDaiRows,
  parseStatementDate,
  parseStatementRows,
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

describe("parseMaiDaiRows", () => {
  const rows: unknown[][] = [
    ["12345", "สมชาย ใจดี", 5000, 5000, 0, "สพป.นค เขต 1", null, "1234567890123", "0431234567", "7"],
    ["12346", "สมหญิง มีสุข", 5000, 2000, 3000, "สพป.นค เขต 1", "ขอผ่อน", "1234567890124", "0431234568", "7"],
    ["12347", "วิชัย ตั้งใจ", 4000, 0, 4000, "สพม.บึงกาฬ", null, "1234567890125", 4470001111, "20"],
    ["", "แถวว่าง", null, null, null, null, null, null, null, null],
  ];

  it("keeps only members who actually have an outstanding amount", () => {
    const parsed = parseMaiDaiRows(rows);
    expect(parsed.map((r) => r.memberNumber)).toEqual(["12346", "12347"]);
  });

  it("reads the fields matching is built on", () => {
    const [first, second] = parseMaiDaiRows(rows);
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
    const serialized = JSON.stringify(parseMaiDaiRows(rows));
    expect(serialized).not.toContain("1234567890124");
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
