import { describe, expect, it } from "vitest";
import { statementLinesCsvRows } from "../lib/csv";
import type { DailyStatementRow } from "../lib/types";

const line = (over: Partial<DailyStatementRow>): DailyStatementRow => ({
  id: "l1",
  postedAt: "2026-10-02T06:37:32.000Z",
  txnCode: "NBSDT",
  description: "TR fr 4301336796",
  amount: 30000,
  balance: 43802301.23,
  account: "413",
  branch: "หนองคาย",
  channel: "x",
  senderAccount: "4301336796",
  status: "matched",
  memberNumber: "13411",
  memberName: "นายสมบูรณ์ วิชิต",
  unitName: "บำนาญ บึงกาฬ อ.ศรีวิไล",
  category: "ฝากเงิน",
  deduction: null,
  ...over,
});

describe("statementLinesCsvRows", () => {
  it("writes each line as the table shows it, the bank's own clock and plain amounts", () => {
    const [header, row] = statementLinesCsvRows([line({})]);
    expect(header).toEqual([
      "วันที่", "เวลา", "รหัส", "รายละเอียด", "บัญชีผู้โอน", "ยอด", "คงเหลือ", "บัญชี",
      "เลขสมาชิก", "ชื่อสมาชิก", "หน่วยงาน", "ทำรายการ", "สถานะ",
    ]);
    expect(row).toEqual([
      "2026-10-02", "06:37:32", "NBSDT", "TR fr 4301336796", "4301336796", "30000.00", "43802301.23",
      "หนองคาย", "13411", "นายสมบูรณ์ วิชิต", "บำนาญ บึงกาฬ อ.ศรีวิไล", "ฝากเงิน", "ตรงกับสลิป",
    ]);
  });

  it("leaves blanks for what a line has not got yet", () => {
    const [, row] = statementLinesCsvRows([
      line({ memberNumber: null, memberName: null, unitName: null, category: null, balance: null, senderAccount: null, status: "unknownPayer" }),
    ]);
    expect(row.slice(4)).toEqual(["", "30000.00", "", "หนองคาย", "", "", "", "", "ยังไม่รู้ว่าใครโอน"]);
  });
});
