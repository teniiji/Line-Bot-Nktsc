import { describe, expect, it } from "vitest";
import { findCategory, findThaiName, messageHintNote } from "../lib/messageHints";

// The message this module exists for. It carries a name and a category, the
// bot took neither, and the member ended up typing her name twice.
const HERS = "ฝากออมทรัพย์พิเศษบัญชีนางพิศวง พรหมจรรย์ จำนวน 200,000บาทค่ะ";

describe("findThaiName", () => {
  it("finds a name glued to the middle of a sentence", () => {
    // "บัญชีนางพิศวง" — Thai writes no spaces between words, so the only
    // thing marking the name is the title.
    expect(findThaiName(HERS)).toBe("นางพิศวง พรหมจรรย์");
  });

  it("reads นางสาว as one title, not นาง plus สาว", () => {
    expect(findThaiName("นางสาวศิราณี วงศาสนธิ์")).toBe("นางสาวศิราณี วงศาสนธิ์");
    expect(findThaiName("นางสาวชาลิสา อ่อนตา")).toBe("นางสาวชาลิสา อ่อนตา");
  });

  it("handles the titles members actually type", () => {
    expect(findThaiName("นายสมชาย ใจดี")).toBe("นายสมชาย ใจดี");
    expect(findThaiName("ผมชื่อ น.ส.กฤตยา ภักดีบรรดิษฐ์ ครับ")).toBe(
      "น.ส.กฤตยา ภักดีบรรดิษฐ์"
    );
  });

  it("does not read นายทะเบียน as somebody called ทะเบียน", () => {
    // A cooperative talks about its registrar. Reading that as a member's
    // name would file a payment under it.
    expect(findThaiName("ติดต่อนายทะเบียน สหกรณ์")).toBeNull();
    expect(findThaiName("นายจ้าง หักเงิน")).toBeNull();
  });

  it("says nothing about a message with no name in it", () => {
    expect(findThaiName("เลขที่สมาชิก 29252")).toBeNull();
    expect(findThaiName("ขอบคุณค่ะ")).toBeNull();
    expect(findThaiName("")).toBeNull();
  });

  it("needs a surname, not a title and one word", () => {
    // "นางสาวคะ" is politeness, not an identity.
    expect(findThaiName("นางสาว")).toBeNull();
    expect(findThaiName("เรียนนายครับ")).toBeNull();
  });

  it("writes the name the way the roster writes one", () => {
    // Title attached, one space before the surname — so what is stored
    // matches what an imported roster row says.
    expect(findThaiName("ชื่อ นาง พิศวง พรหมจรรย์")).toBe("นางพิศวง พรหมจรรย์");
  });
});

describe("findCategory", () => {
  it("reads the category out of the same sentence", () => {
    expect(findCategory(HERS)).toBe("ฝากเงิน");
  });

  it("knows what members call each one", () => {
    expect(findCategory("ชำระหนี้ค่ะ")).toBe("ชำระหนี้");
    expect(findCategory("ซื้อหุ้นเพิ่ม 2000")).toBe("ซื้อหุ้น");
    expect(findCategory("จ่ายฌาปนกิจ")).toBe("ชำระฌาปนกิจ");
    expect(findCategory("โอนค่าเก็บไม่ได้เดือนนี้")).toBe("ชำระเก็บไม่ได้รายเดือน");
    expect(findCategory("สส.อค")).toBe("สสอค");
  });

  it("says nothing when the message could be two categories", () => {
    // The one a person should be asked about. A hint that could be either is
    // no better than none.
    expect(findCategory("ชำระหนี้กับซื้อหุ้นค่ะ")).toBeNull();
  });

  it("does not read the ฝาก in an ordinary polite sentence", () => {
    // "ฝาก" alone is in half the polite sentences in Thai, which is why no
    // phrase here is just that word.
    expect(findCategory("ฝากดูให้หน่อยค่ะ")).toBeNull();
    expect(findCategory("ฝากบอกเจ้าหน้าที่ด้วย")).toBeNull();
  });

  it("says nothing about a message that names none", () => {
    expect(findCategory("นางพิศวง พรหมจรรย์")).toBeNull();
    expect(findCategory("")).toBeNull();
  });
});

describe("messageHintNote", () => {
  it("names both when both are outstanding", () => {
    const note = messageHintNote({ text: HERS, needsName: true, needsCategory: true });
    expect(note).toContain("นางพิศวง พรหมจรรย์");
    expect(note).toContain("ฝากเงิน");
    expect(note).toContain("submit_member_info");
  });

  it("says nothing about what is already on record", () => {
    // A hint about a name already held invites the model to overwrite the
    // roster's spelling with one read out of a sentence.
    const note = messageHintNote({ text: HERS, needsName: false, needsCategory: true });
    expect(note).not.toContain("พรหมจรรย์");
    expect(note).toContain("ฝากเงิน");
  });

  it("is empty when the message answered nothing", () => {
    expect(messageHintNote({ text: "ขอบคุณค่ะ", needsName: true, needsCategory: true })).toBe("");
  });

  it("is empty for a message with no text of its own", () => {
    // An image on its own has nothing to read.
    expect(messageHintNote({ text: null, needsName: true, needsCategory: true })).toBe("");
  });

  it("is empty when nothing is outstanding", () => {
    expect(messageHintNote({ text: HERS, needsName: false, needsCategory: false })).toBe("");
  });

  it("leaves the model room to disagree", () => {
    // Found by rule, applied by the model — it can see the whole message and
    // this cannot.
    const note = messageHintNote({ text: HERS, needsName: true, needsCategory: true });
    expect(note).toContain("ให้ข้ามข้อนั้นไปได้");
  });
});
