import { describe, expect, it } from "vitest";
import { parseLineIdSheet, planLinks, SKIP_REASONS } from "../lib/lineLinking";

const id = (n: number) => `U${String(n).padStart(32, "0")}`;

const state = () => ({
  lineUsers: new Map([
    [id(1), { memberNumber: null, label: "ครูแอน" }],
    [id(2), { memberNumber: "200", label: "บี" }],
    [id(3), { memberNumber: "300", label: "ซี" }],
    [id(4), { memberNumber: null, label: "ดี" }],
  ]),
  roster: new Map([
    ["100", { memberName: "นางหนึ่ง", lineUserId: null }],
    ["200", { memberName: "นายสอง", lineUserId: null }],
    ["300", { memberName: "นายสาม", lineUserId: id(3) }],
    ["400", { memberName: "นางสี่", lineUserId: id(9) }],
  ]),
  numberHolders: new Map([
    ["200", [id(2)]],
    ["300", [id(3)]],
  ]),
});

const actions = (out: ReturnType<typeof planLinks>) =>
  Object.fromEntries(out.map((o) => [`${o.lineUserId.slice(-1)}:${o.memberNumber}`, o.reason ?? o.action]));

describe("linking LINE accounts to members in bulk", () => {
  it("links, binds an unbound row, and leaves what is already done", () => {
    const out = planLinks(
      [
        { lineUserId: id(1), memberNumber: "0100" },
        { lineUserId: id(2), memberNumber: "200" },
        { lineUserId: id(3), memberNumber: "300" },
      ],
      state()
    );
    expect(actions(out)).toEqual({ "1:100": "link", "2:200": "link", "3:300": "already" });
    expect(out[0].memberName).toBe("นางหนึ่ง");
  });

  it("refuses what would file one member's money under another", () => {
    const out = planLinks(
      [
        { lineUserId: id(5), memberNumber: "100" },
        { lineUserId: id(2), memberNumber: "100" },
        { lineUserId: id(4), memberNumber: "400" },
        { lineUserId: id(4), memberNumber: "999" },
      ],
      state()
    );
    expect(actions(out)).toEqual({
      "5:100": SKIP_REASONS.notMessaged,
      "2:100": SKIP_REASONS.duplicate,
      "4:400": SKIP_REASONS.duplicate,
      "4:999": SKIP_REASONS.duplicate,
    });
    expect(actions(planLinks([{ lineUserId: id(4), memberNumber: "400" }], state()))).toEqual({
      "4:400": SKIP_REASONS.boundElsewhere,
    });
    expect(actions(planLinks([{ lineUserId: id(4), memberNumber: "999" }], state()))).toEqual({
      "4:999": SKIP_REASONS.notInRoster,
    });
    expect(actions(planLinks([{ lineUserId: id(2), memberNumber: "100" }], state()))).toEqual({
      "2:100": SKIP_REASONS.otherNumber,
    });
    expect(actions(planLinks([{ lineUserId: id(4), memberNumber: "200" }], state()))).toEqual({
      "4:200": SKIP_REASONS.heldElsewhere,
    });
  });
});

describe("the สมาชิก_LINE_OA sheet", () => {
  it("finds the columns by heading on whichever page has them", () => {
    const pages = [
      [["อื่นๆ"]],
      [
        ["เลขสมาชิก", "ชื่อ", "หน่วยงาน", "LINE_UserID", "Nickname (LINE OA)"],
        ["31744", "นางสาวทดสอบ", "สพป", id(1), "x"],
        ["31745", "นายไม่มี", "สพป", "", ""],
        ["31746", "นายผิดรูป", "สพป", "not-an-id", ""],
      ],
    ];
    expect(parseLineIdSheet(pages)).toEqual({ pairs: [{ lineUserId: id(1), memberNumber: "31744" }], badIds: 1 });
  });

  it("refuses a file without the headings", () => {
    expect(() => parseLineIdSheet([[["a", "b"]]])).toThrow("LINE_UserID");
  });
});
