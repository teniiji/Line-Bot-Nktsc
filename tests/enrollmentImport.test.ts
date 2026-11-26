import { describe, expect, it } from "vitest";
import {
  ApplicantSheetError,
  SKIP,
  YEARLY_FILE,
  parseApplicantSheet,
  planApplicants,
  roundDate,
  samePerson,
  type PlanContext,
} from "../lib/enrollmentImport";

// As the associations send them: the association's own number first, the
// cooperative's member number after, relatives with a letter in front.
const SSOK_SHEET = [
  ["ลำดับ", "เลขสมาชิก สอ.", "เลขณาปนกิจ", "ชื่อ - สกุล", "ชื่อ", "สกุล", "บัตรประชาชน", "รอบ", "ค่าบำรุงรายปี", "เงินสงเคราะห์ล่วงหน้า", "เงินไม่พอจ่าย", "จำนวนเรียกเก็บ"],
  [1, 29689, null, "นางณัฎฐณิชา  สีดามุย", "ณัฎฐณิชา", "สีดามุย", 1411200180644, "11/69", 50, 5130, 0, 5180],
  [2, 29544, null, "นายมานะศักดิ์ หมื่นภักดี", "มานะศักดิ์", "หมื่นภักดี", 1301300088872, "11/69", 50, 5130, 0, 5180],
  [3, "ม29477", null, "นางอมรรัตน์  พิเภก", "อมรรัตน์", "พิเภก", 3400101577720, "11/2569", 50, 0, 4990, 5040],
  [4, "030809", null, "นายปริญญา  ตะระชู", "ปริญญา", "ตะระชู", 3410101573198, "11/69", 50, 5130, 0, 5180],
  [5, 31616, null, "นางสาวพลอยอินทร์ เวียงสมุทร", "สาวพลอยอินทร์", "เวียงสมุทร", 1470500137131, "", 50, 5130, 0, 5180],
  [6, 99999, null, "นายไม่มี ในทะเบียน", "", "", 1, "11/69", 50, 0, 0, 5180],
  [7, 29689, null, "นางณัฎฐณิชา  สีดามุย", "", "", 1, "11/69", 50, 5130, 0, 5180],
  [null, null, null, null, null, null, "รวม", null, 350, 0, 0, 36260],
];

describe("parseApplicantSheet", () => {
  it("reads the member number, a relative's mark, the name, round and amount", () => {
    const { rows, hasLifeColumns } = parseApplicantSheet([SSOK_SHEET]);
    expect(hasLifeColumns).toBe(false);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      memberNumber: "29689",
      relativeMark: null,
      name: "นางณัฎฐณิชา สีดามุย",
      round: "11/69",
      amount: 5180,
      insuredSum: null,
      annualPremium: null,
    });
    expect(rows[2]).toMatchObject({ memberNumber: "29477", relativeMark: "ม", name: "นางอมรรัตน์ พิเภก", round: "11/2569" });
    expect(rows[3].memberNumber).toBe("30809");
  });

  it("puts the name together from its parts when there is no full-name column, and reads a life list", () => {
    const { rows, hasLifeColumns } = parseApplicantSheet([
      [
        ["ลำดับ", "เลขสมาชิก", "คำนำหน้า", "ชื่อ", "สกุล", "เบี้ยประกัน\nรายปี", "วงเงินคุ้มครอง"],
        [1, "00001449", "นาง", "วรางคณา", "ตันไพศาล", 28800, "3,000,000.00"],
      ],
    ]);
    expect(hasLifeColumns).toBe(true);
    expect(rows[0]).toMatchObject({ memberNumber: "1449", name: "นาง วรางคณา ตันไพศาล", insuredSum: 3000000, annualPremium: 28800 });
  });

  it("refuses a sheet without a member number column", () => {
    expect(() => parseApplicantSheet([[["ชื่อ", "สกุล"]]])).toThrow(ApplicantSheetError);
  });
});

describe("roundDate", () => {
  it("reads two- and four-digit Buddhist years", () => {
    expect(roundDate("11/69")).toBe("2026-11-01");
    expect(roundDate("11/2569")).toBe("2026-11-01");
    expect(roundDate("3/70")).toBe("2027-03-01");
    expect(roundDate("13/69")).toBeNull();
    expect(roundDate(null)).toBeNull();
  });
});

describe("samePerson", () => {
  it("ignores titles and spacing, and allows a misspelt first name or surname", () => {
    expect(samePerson("นางสาวอภิญญา  พิเภก", "อภิญญา พิเภก")).toBe(true);
    expect(samePerson("นายณัฎฐณิชา สีดามุย", "นางณัฏฐณิชา สีดามุย")).toBe(true);
    expect(samePerson("นายมานะศักดิ์ หมื่นภักดี", "นางสาวมิถุนา สิงห์เปี้ย")).toBe(false);
  });
});

describe("planApplicants", () => {
  const ctx: PlanContext = {
    product: "sok",
    defaultDate: "2026-11-26",
    roster: new Map([
      ["29689", { memberName: "นางณัฏฐณิชา สีดามุย" }],
      ["29544", { memberName: "นางสาวมิถุนา สิงห์เปี้ย" }],
      ["29477", { memberName: "นางสาวอภิญญา พิเภก" }],
      ["30809", { memberName: "นายปริญญา ตะระชู" }],
      ["31616", { memberName: "นางสาวพลอยอินทร์ เวียงสมุทร" }],
    ]),
    recorded: [{ memberNumber: "30809", product: "sok", relativeName: null }],
    inYearlyFile: new Set(["31616"]),
  };

  it("records new applicants and says why the rest are left out", () => {
    const plan = planApplicants(parseApplicantSheet([SSOK_SHEET]).rows, ctx);
    expect(plan.map((p) => [p.memberNumber, p.product, p.action, p.reason, p.applicationDate])).toEqual([
      ["29689", "sok", "create", null, "2026-11-01"],
      ["29544", "sok", "skip", SKIP.nameMismatch, "2026-11-01"],
      ["29477", "relative", "create", null, "2026-11-01"],
      ["30809", "sok", "skip", SKIP.recorded, "2026-11-01"],
      ["31616", "sok", "skip", SKIP.inFile, "2026-11-26"],
      ["99999", "sok", "skip", SKIP.notMember, "2026-11-01"],
      ["29689", "sok", "skip", SKIP.repeated, "2026-11-01"],
    ]);
    expect(plan[1].rosterName).toBe("นางสาวมิถุนา สิงห์เปี้ย");
  });

  it("does not record a relative twice, nor a life applicant without a sum", () => {
    const relative = planApplicants(parseApplicantSheet([SSOK_SHEET]).rows.slice(2, 3), {
      ...ctx,
      recorded: [{ memberNumber: "29477", product: "relative", relativeName: "อมรรัตน์ พิเภก" }],
    });
    expect(relative[0]).toMatchObject({ action: "skip", reason: SKIP.recorded });

    const life = planApplicants(
      [{ rowNumber: 2, memberNumber: "29689", relativeMark: null, name: null, round: null, amount: null, insuredSum: null, annualPremium: 9600 }],
      { ...ctx, product: "life" }
    );
    expect(life[0]).toMatchObject({ action: "skip", reason: SKIP.noLife });
  });
});

describe("parseApplicantSheet on the yearly file", () => {
  it("refuses it, pointing to the yearly import", () => {
    const yearly = [
      ["สรุป"],
      ["เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "หุ้น", "หนี้รวม", "ทุนประกัน", "เบี้ยประกัน", "สสอค.", "สส.ชสอ.", "สส.สท.", "สส.สก."],
      [753, "นายกมล ราชบัณฑิต", "หน่วย", 1000, 0, 0, 0, null, null, null, null],
    ];
    expect(() => parseApplicantSheet([[["สมาชิกทั้งสหกรณ์"]], yearly])).toThrow(YEARLY_FILE);
  });
});
