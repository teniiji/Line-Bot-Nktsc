// The example files behind "ดาวน์โหลดไฟล์ตัวอย่าง".
//
// Both importers find their columns by heading rather than by position, which
// makes them forgiving of whatever the cooperative's own files look like — and
// leaves somebody starting from nothing with no idea what to type. A template
// answers that in the one way documentation cannot: it opens, and it imports.
//
// The headings here are deliberately the plainest spelling each parser
// accepts, and the tests feed these very rows back through the parsers. A
// template that stopped importing would be worse than none, and that is
// exactly the kind of drift nobody notices until somebody tries it.

// Above the header, not inside it. The parsers scan the first twenty rows for
// a row carrying their required headings, and take the first one that has
// them — which is why this sentence must not contain any heading word itself.
// It did, on the first attempt: the bank-account note explained that "ชื่อ" was
// optional and that punctuation in "เลขบัญชี" did not matter, and the parser
// duly read the note row as the header and every value out of column one. The
// tests parse the templates for exactly this reason.
export const TEMPLATE_NOTE =
  "กรอกข้อมูลต่อจากแถวตัวอย่างด้านล่าง แล้วลบแถวตัวอย่างออกก่อนนำเข้า · หัวตารางห้ามแก้ · สลับลำดับคอลัมน์หรือเพิ่มคอลัมน์อื่นได้";

export interface SheetTemplate {
  fileName: string;
  sheetName: string;
  note: string;
  header: string[];
  // Kept obviously fake in the name column: if one ever survives into a real
  // import, it is recognisable on the screen rather than filed as a member.
  examples: string[][];
  // Column widths, so the file opens readable instead of as a row of ####.
  widths: number[];
}

export const MEMBER_ROSTER_TEMPLATE: SheetTemplate = {
  fileName: "nktsc-template-members.xlsx",
  sheetName: "ทะเบียนสมาชิก",
  note: TEMPLATE_NOTE,
  // The account column belongs here as well as in its own template: staff
  // keep all of this in one spreadsheet, and asking them to split it into two
  // files to load it is asking them to do the join by hand. Leaving it blank
  // is fine — a column the file does not fill changes nothing.
  header: ["เลขสมาชิก", "ชื่อ-สกุล", "สังกัด", "เลขบัตรประชาชน", "เบอร์โทร", "เลขที่บัญชี"],
  examples: [
    [
      "10152",
      "(ตัวอย่าง) นายนิพนธ์ จำวงศ์",
      "บำนาญ อ.เมือง นค.",
      "3430100128262",
      "0807597560",
      "982-5-07219-9",
    ],
    [
      "10175",
      "(ตัวอย่าง) นางวิไลลักษณ์ ตระกูลพรพงศ์",
      "สพป.นค. เขต 1",
      "3430100123188",
      "0844050754",
      "9825072188",
    ],
  ],
  widths: [12, 32, 24, 18, 14, 18],
};

export const BANK_ACCOUNT_TEMPLATE: SheetTemplate = {
  fileName: "nktsc-template-bank-accounts.xlsx",
  sheetName: "ทะเบียนเลขบัญชี",
  // Worded around the heading words on purpose — see TEMPLATE_NOTE.
  note: TEMPLATE_NOTE + " · ช่องบัญชีใส่ขีดหรือไม่ใส่ก็ได้ ระบบเก็บเฉพาะตัวเลข",
  header: ["เลขสมาชิก", "ชื่อ-สกุล", "เลขที่บัญชี"],
  examples: [
    ["10152", "(ตัวอย่าง) นายนิพนธ์ จำวงศ์", "982-5-07219-9"],
    ["10175", "(ตัวอย่าง) นางวิไลลักษณ์ ตระกูลพรพงศ์", "9825072188"],
  ],
  widths: [12, 32, 20],
};

// The rows as an importer would see them, which is also what the tests parse.
export function templateRows(template: SheetTemplate): string[][] {
  return [[template.note], template.header, ...template.examples];
}
