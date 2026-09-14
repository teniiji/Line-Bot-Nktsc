import { describe, expect, it } from "vitest";
import {
  CHANNEL_LABELS,
  classifyChannel,
  extractSenderAccount,
  isMemberDeposit,
  parseStatementLines,
  statementLineFingerprint,
} from "../lib/statementLines";

// Shaped like the bank's own export: four header rows, a blank, the column
// titles, then lines.
const header: unknown[][] = [
  ["Account No.", "413-1-00127-6", "Currency", "THB"],
  ["Account Name", "สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด"],
  ["Alias Name", "สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด", "Branch Name", "NONGKHAI BR."],
  ["Ledger Balance", "54,086,844.09", "Available Balance", "54,086,844.09"],
  [],
  ["Date", "Teller Id", "Transaction Code", "Description", "Cheque No.", "Amount", "Tax", "Balance"],
];

const line = (
  date: string,
  code: string,
  description: string,
  amount: number | string,
  balance?: number
): unknown[] => [date, "T1", code, description, null, amount, null, balance ?? null];

describe("classifyChannel", () => {
  it("names the ways a member can pay in", () => {
    expect(classifyChannel("NBSDT", 5000)).toBe("transfer");
    expect(classifyChannel("IORSDT", 5000)).toBe("counter");
    expect(classifyChannel("ATSDT", 5000)).toBe("atm");
    expect(classifyChannel("PTSDT", 5000)).toBe("ewallet");
  });

  it("leaves a code nobody has seen in อื่นๆ rather than guessing", () => {
    // Guessing the other way would put institutional money into a member's
    // reconciliation, which is the more expensive mistake.
    expect(classifyChannel("ZZNEW", 5000)).toBe("other");
    expect(isMemberDeposit(classifyChannel("ZZNEW", 5000))).toBe(false);
  });

  it("never counts money leaving the account, whatever the code", () => {
    expect(classifyChannel("NBSDT", -5000)).toBe("other");
    expect(classifyChannel("BPSFE", -8)).toBe("other");
  });

  it("has a label for every channel it can produce", () => {
    const produced = ["NBSDT", "IORSDT", "ATSDT", "ATSDC", "MORPSD", "PTSDT", "SDCH", "ZZNEW"].map(
      (code) => classifyChannel(code, 1)
    );
    for (const channel of produced) expect(CHANNEL_LABELS[channel]).toBeTruthy();
  });
});

describe("extractSenderAccount", () => {
  it("reads the account off a transfer line", () => {
    expect(extractSenderAccount("TR fr 4131572885")).toBe("4131572885");
  });

  it("reads the depositing account off a branch line", () => {
    expect(extractSenderAccount("004-2248282765")).toBe("2248282765");
    expect(extractSenderAccount("K07273-6640786087")).toBe("6640786087");
  });

  it("is not thrown off by the bank's trailing note", () => {
    expect(extractSenderAccount("014-8872614889 Future Amount: 1500 Tran")).toBe("8872614889");
  });

  it("does not read a wallet id as an account", () => {
    // "TR from EWALLETID" must not be mistaken for the "TR fr <account>" form.
    expect(extractSenderAccount("TR from EWALLETID 660078930301")).toBeNull();
  });

  it("does not invent one from a description that names no account", () => {
    expect(extractSenderAccount("ทรรศนีย์ สุวรรณภักดี")).toBeNull();
    expect(extractSenderAccount("CWTC/ฌาปนกิจสงเคราะห์สมาชิกสหกรณ์")).toBeNull();
    expect(extractSenderAccount("010753700088205-BU0994005S00999915K")).toBeNull();
  });
});

describe("parseStatementLines", () => {
  it("keeps the lines a round throws away", () => {
    const lines = parseStatementLines([
      ...header,
      line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", "10,000.00", 115686835.8),
      line("17-08-2026 06:15:03", "IORSDT", "004-2248282765", "630,000.00", 115656835.8),
      line("17-08-2026 13:53:56", "ATSDT", "K07273-6640786087", "38,000.00", 116001695.8),
    ]);

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.channel)).toEqual(["transfer", "counter", "atm"]);
    expect(lines.every((l) => isMemberDeposit(l.channel))).toBe(true);
  });

  it("keeps the bank's own postings too, marked as อื่นๆ", () => {
    const lines = parseStatementLines([
      ...header,
      line("18-08-2026 10:00:00", "BSD14", "CWTC/ฌาปนกิจสงเคราะห์", "90,294,320.03", 200000000),
      line("18-08-2026 10:05:00", "BPSFE", "BP Fee-1000012172547", "-8.00", 199999992),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.channel)).toEqual(["other", "other"]);
  });

  it("skips the export's header block instead of reading it as money", () => {
    expect(parseStatementLines(header)).toHaveLength(0);
  });

  it("keeps the time of day, which is what a daily reconciliation runs on", () => {
    const [first] = parseStatementLines([
      ...header,
      line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", 10000, 1),
    ]);
    expect(first.postedAt?.toISOString()).toBe("2026-08-17T09:07:46.000Z");
  });
});

describe("statementLineFingerprint", () => {
  const rows = (extra: unknown[][]) => parseStatementLines([...header, ...extra]);

  it("gives a line the same identity every time the file is uploaded", () => {
    const a = rows([line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", 10000, 500)]);
    const b = rows([line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", 10000, 500)]);
    expect(statementLineFingerprint("413", a[0])).toBe(statementLineFingerprint("413", b[0]));
  });

  it("separates two payments that differ only by the clock", () => {
    const parsed = rows([
      line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", 5000, 100),
      line("17-08-2026 14:32:07", "NBSDT", "TR fr 4131572885", 5000, 200),
    ]);
    expect(statementLineFingerprint("413", parsed[0])).not.toBe(
      statementLineFingerprint("413", parsed[1])
    );
  });

  it("separates the same line arriving on the other account's statement", () => {
    const [only] = rows([line("17-08-2026 09:07:46", "NBSDT", "TR fr 4131572885", 10000, 500)]);
    expect(statementLineFingerprint("413", only)).not.toBe(statementLineFingerprint("447", only));
  });

  it("counts repeats when the bank gives nothing to tell them apart", () => {
    const parsed = rows([
      line("17-08-2026 09:07:46", "IORSDT", "004-2248282765", 500),
      line("17-08-2026 09:07:46", "IORSDT", "004-2248282765", 500),
    ]);
    expect(parsed.map((l) => l.occurrence)).toEqual([0, 1]);
    expect(statementLineFingerprint("413", parsed[0])).not.toBe(
      statementLineFingerprint("413", parsed[1])
    );
  });
});
