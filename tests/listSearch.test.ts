import { describe, expect, it } from "vitest";
import {
  UNIT_FILTERS,
  filterBy,
  filterUnits,
  formLinkHaystack,
  knowledgeHaystack,
  matchesTerms,
  matchesUnitFilter,
  unitHaystack,
} from "../lib/listSearch";
import type { DeductionUnitRow } from "../lib/types";

const unit = (over: Partial<DeductionUnitRow> = {}): DeductionUnitRow => ({
  id: "u1",
  unitName: "โรงเรียนอนุบาลเซกา",
  groupName: "อ.เซกา",
  contactName: "นางสมหญิง ใจดี",
  email: "seka@example.ac.th",
  hasLineId: true,
  contactMethod: "line",
  fileName: "รายการหัก-เซกา.xlsx",
  fileUrl: "https://blob/x.xlsx",
  amount: 128400,
  memberCount: 42,
  sendStatus: "sent",
  sentAt: "2026-09-05T03:00:00.000Z",
  sentVia: "line",
  sendError: null,
  ...over,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "ยังไม่ส่ง",
  sent: "ส่งแล้ว",
  failed: "ส่งไม่สำเร็จ",
  skipped: "ข้ามรอบนี้",
};
const label = (status: string) => STATUS_LABEL[status] ?? status;

const round: DeductionUnitRow[] = [
  unit({ id: "a", unitName: "โรงเรียนอนุบาลเซกา", sendStatus: "sent" }),
  unit({
    id: "b",
    unitName: "โรงเรียนบ้านโพนแพง",
    groupName: "อ.รัตนวาปี",
    fileName: null,
    fileUrl: null,
    amount: null,
    sendStatus: "pending",
  }),
  unit({
    id: "c",
    unitName: "สพป.หนองคาย เขต 1",
    fileName: "รายการหัก-สพป1.xlsx",
    sendStatus: "failed",
  }),
  unit({ id: "d", unitName: "โรงเรียนบ้านหม้อ", sendStatus: "skipped", fileName: null }),
];

describe("matchesTerms", () => {
  it("needs every word, so a second word narrows the list", () => {
    expect(matchesTerms("โรงเรียนอนุบาลเซกา ส่งแล้ว", "เซกา ส่งแล้ว")).toBe(true);
    expect(matchesTerms("โรงเรียนอนุบาลเซกา ส่งแล้ว", "เซกา ยังไม่ส่ง")).toBe(false);
  });

  it("matches everything when nothing was typed", () => {
    expect(matchesTerms("อะไรก็ได้", "   ")).toBe(true);
  });
});

describe("filterUnits", () => {
  it("finds a unit by a fragment of its name", () => {
    const found = filterUnits(round, "โพนแพง", "all", label);
    expect(found.map((u) => u.id)).toEqual(["b"]);
  });

  it("finds one by the file staff uploaded for it", () => {
    // The name on the file is what staff have in front of them when they are
    // checking whether it went up.
    expect(filterUnits(round, "รายการหัก-เซกา", "all", label).map((u) => u.id)).toEqual(["a"]);
  });

  it("finds one by its contact's email", () => {
    expect(filterUnits(round, "seka@example.ac.th", "all", label)).toHaveLength(4);
  });

  it("answers the question the month starts with", () => {
    // "ยังไม่มีไฟล์" — the list of units still to chase, which was eleven
    // screens of eye-work.
    expect(filterUnits(round, "", "noFile", label).map((u) => u.id)).toEqual(["b", "d"]);
    expect(filterUnits(round, "", "hasFile", label).map((u) => u.id)).toEqual(["a", "c"]);
  });

  it("counts a failed send as still outstanding and a skip as not", () => {
    // A unit staff deliberately skipped this round is not work left to do; a
    // send that failed very much is.
    const unsent = filterUnits(round, "", "unsent", label).map((u) => u.id);
    expect(unsent).toContain("b");
    expect(unsent).toContain("c");
    expect(unsent).not.toContain("d");
    expect(unsent).not.toContain("a");
  });

  it("combines the filter with what was typed", () => {
    expect(filterUnits(round, "โรงเรียน", "noFile", label).map((u) => u.id)).toEqual(["b", "d"]);
  });

  it("searches the status as it is written on screen", () => {
    // Staff read "ส่งไม่สำเร็จ" in the table, not "failed".
    expect(filterUnits(round, "ส่งไม่สำเร็จ", "all", label).map((u) => u.id)).toEqual(["c"]);
  });

  it("hands back everything when nothing is narrowed", () => {
    expect(filterUnits(round, "", "all", label)).toHaveLength(round.length);
  });

  it("has a label for every filter it offers", () => {
    for (const option of UNIT_FILTERS) {
      expect(matchesUnitFilter(unit(), option)).toBeTypeOf("boolean");
    }
  });
});

describe("unitHaystack", () => {
  it("holds the amount both as typed and as displayed", () => {
    // 128400 and ฿128,400.00 are the same figure; a person may type either.
    const hay = unitHaystack(unit());
    expect(hay).toContain("128400");
    expect(hay).toContain("128,400");
  });

  it("does not break on a unit with nothing filled in", () => {
    const bare = unit({
      groupName: null,
      contactName: null,
      email: null,
      fileName: null,
      amount: null,
    });
    expect(() => unitHaystack(bare)).not.toThrow();
    expect(unitHaystack(bare)).toContain("โรงเรียนอนุบาลเซกา".toLowerCase());
  });
});

describe("formLinkHaystack", () => {
  const links = [
    { key: "loan_general", label: "แบบฟอร์มกู้เงินสามัญ", url: "https://drive.google.com/aaa" },
    { key: "guarantor_change", label: "แบบฟอร์มเปลี่ยนคนค้ำ", url: "https://drive.google.com/bbb" },
  ];

  it("finds a form by its name", () => {
    expect(filterBy(links, "เปลี่ยนคนค้ำ", formLinkHaystack)).toHaveLength(1);
  });

  it("finds one by its key, which is what the bot matches on", () => {
    expect(filterBy(links, "loan_general", formLinkHaystack)[0].label).toBe(
      "แบบฟอร์มกู้เงินสามัญ"
    );
  });

  it("finds one by part of its link", () => {
    expect(filterBy(links, "bbb", formLinkHaystack)).toHaveLength(1);
  });
});

describe("knowledgeHaystack", () => {
  const entries = [
    { key: "contact", title: "ข้อมูลติดต่อ", content: "โทร 042-411334, 042-423355" },
    { key: "welfare", title: "สวัสดิการสมาชิก", content: "ฌาปนกิจสงเคราะห์ ..." },
  ];

  it("searches the body, not only the heading", () => {
    // A telephone number is never a title, and it is exactly what somebody
    // comes here to correct.
    expect(filterBy(entries, "042-423355", knowledgeHaystack)[0].title).toBe("ข้อมูลติดต่อ");
  });

  it("still finds a heading", () => {
    expect(filterBy(entries, "สวัสดิการ", knowledgeHaystack)).toHaveLength(1);
  });
});
