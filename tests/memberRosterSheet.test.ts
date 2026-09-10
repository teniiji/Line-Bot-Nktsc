import { describe, expect, it } from "vitest";
import {
  MemberRosterSheetError,
  dedupeByMember,
  findMemberConflicts,
  parseMemberRosterSheet,
} from "../lib/memberRosterSheet";

const HEADER = ["ลำดับ", "เลขสมาชิก", "ชื่อ-สกุล", "สังกัด", "เลขบัตรประชาชน", "เบอร์โทร"];
const row = (
  no: string,
  member: string,
  name: string,
  unit = "บำนาญ อ.เมือง นค.",
  id = "3430100123456",
  phone = "0812345678"
) => [no, member, name, unit, id, phone];

describe("parseMemberRosterSheet", () => {
  it("finds the columns by their headings, wherever they sit", () => {
    // Never by position. Every one of these sheets is kept by hand in a
    // different order, and a fixed index reads an ID card number into the
    // phone column without saying so.
    const shuffled = [
      ["เบอร์โทร", "ชื่อสมาชิก", "เลขที่สมาชิก"],
      ["0812345678", "นางสาวชาลิสา อ่อนตา", "28374"],
    ];
    const sheet = parseMemberRosterSheet(shuffled);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({
      memberNumber: "28374",
      memberName: "นางสาวชาลิสา อ่อนตา",
      phone: "0812345678",
    });
  });

  it("skips a title row and finds the header below it", () => {
    const sheet = parseMemberRosterSheet([
      ["ทะเบียนสมาชิก สหกรณ์ออมทรัพย์ครูหนองคาย"],
      [],
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา"),
    ]);
    expect(sheet.rows).toHaveLength(1);
  });

  it("refuses a file with no recognisable header rather than guessing", () => {
    // Guessing here writes real members' details into the wrong columns.
    expect(() =>
      parseMemberRosterSheet([
        ["28374", "นางสาวชาลิสา อ่อนตา", "0812345678"],
        ["28375", "นายสมชาย ใจดี", "0823456789"],
      ])
    ).toThrow(MemberRosterSheetError);
  });

  it("strips leading zeros so the file and the database name one member", () => {
    // "029262" and "29262" cannot be two different members — see
    // lib/memberNumber.ts for the ฿4,200 this cost.
    const sheet = parseMemberRosterSheet([HEADER, row("1", "028374", "นางสาวชาลิสา อ่อนตา")]);
    expect(sheet.rows[0].memberNumber).toBe("28374");
  });

  it("drops a badly formed national ID and says which row it came from", () => {
    // Never guessed at, never written. "Cannot be verified yet" is safe;
    // "verified against the wrong number" is not.
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา", "หน่วย ก", "343010012", "0812345678"),
    ]);
    expect(sheet.rows[0].nationalId).toBeNull();
    // The rest of the row still imports — the name and unit are fine.
    expect(sheet.rows[0].memberName).toBe("นางสาวชาลิสา อ่อนตา");
    expect(sheet.rows[0].phone).toBe("0812345678");
    expect(sheet.problems).toHaveLength(1);
    expect(sheet.problems[0].reason).toContain("13 หลัก");
  });

  it("repairs a phone number Excel stripped the leading zero from", () => {
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา", "หน่วย ก", "3430100123456", "812345678"),
    ]);
    expect(sheet.rows[0].phone).toBe("0812345678");
    expect(sheet.problems).toHaveLength(0);
  });

  it("reports half a row instead of importing it", () => {
    const sheet = parseMemberRosterSheet([
      HEADER,
      ["1", "", "นางสาวชาลิสา อ่อนตา"],
      ["2", "28375", ""],
    ]);
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.problems).toHaveLength(2);
  });

  it("counts blank rows without calling them problems", () => {
    // Trailing blanks and spacer rows are not mistakes.
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา"),
      [],
      ["", "", ""],
    ]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.blankRows).toBe(2);
    expect(sheet.problems).toHaveLength(0);
  });

  it("says which optional columns the file actually had", () => {
    // So "why did nothing get filled in" is answerable from the screen
    // instead of being a mystery about the import.
    const sheet = parseMemberRosterSheet([
      ["เลขสมาชิก", "ชื่อ"],
      ["28374", "นางสาวชาลิสา อ่อนตา"],
    ]);
    expect(sheet.columns).toEqual({ unit: false, nationalId: false, phone: false });
    expect(sheet.rows[0].nationalId).toBeNull();
    expect(sheet.rows[0].phone).toBeNull();
  });
});

describe("findMemberConflicts", () => {
  it("catches one member number given two different names", () => {
    // The last row would win silently, which is a wrong answer to a question
    // only the file can settle.
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา"),
      row("2", "28374", "นายสมชาย ใจดี"),
    ]);
    const conflicts = findMemberConflicts(sheet.rows);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].memberNumber).toBe("28374");
    expect(conflicts[0].names).toHaveLength(2);
  });

  it("does not call the same member listed twice a conflict", () => {
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา"),
      row("2", "28374", "นางสาวชาลิสา อ่อนตา"),
    ]);
    expect(findMemberConflicts(sheet.rows)).toHaveLength(0);
  });
});

describe("dedupeByMember", () => {
  it("keeps one row per member, the last one in the file", () => {
    const sheet = parseMemberRosterSheet([
      HEADER,
      row("1", "28374", "นางสาวชาลิสา อ่อนตา", "หน่วย ก"),
      row("2", "28374", "นางสาวชาลิสา อ่อนตา", "หน่วย ข"),
      row("3", "28375", "นายสมชาย ใจดี"),
    ]);
    const rows = dedupeByMember(sheet.rows);
    expect(rows).toHaveLength(2);
    expect(rows[0].unitName).toBe("หน่วย ข");
  });
});
