import { describe, expect, it } from "vitest";
import { defuseBareDomains, sanitiseReplyText, stripMarkdown } from "../lib/replyText";

const JOINER = "⁠";

describe("defuseBareDomains", () => {
  it("breaks the domain that pulled a gambling advert into the cooperative's channel", () => {
    // The address is genuinely nktsc.org@gmail.com. The old nktsc.org website
    // expired and is now squatted with gambling content, and LINE fetched it
    // with no scheme in front of it.
    const out = defuseBareDomains("อีเมล nktsc.org@gmail.com");
    expect(out).toBe(`อีเมล nktsc${JOINER}.org@gmail${JOINER}.com`);
  });

  it("leaves the address readable and copyable", () => {
    // U+2060 has no width and is not a space, so what a member sees and
    // copies is still the address.
    const out = defuseBareDomains("nktsc.org@gmail.com");
    expect(out.replace(new RegExp(JOINER, "g"), "")).toBe("nktsc.org@gmail.com");
    expect(out).not.toContain(" ");
  });

  it("does not touch an amount, a time, or a filename", () => {
    // All of these contain a dot and none of them is a domain.
    for (const text of ["ยอด 1,234.56 บาท", "ไม่เกิน 15.00 น.", "ไฟล์ รายการหัก.xlsx"]) {
      expect(defuseBareDomains(text), text).toBe(text);
    }
  });

  it("does not touch a Thai abbreviation written with dots", () => {
    // น.ส., ส.ส.ค. — mangling these would be worse than the advert.
    for (const text of ["น.ส.กฤตยา ภักดีบรรดิษฐ์", "สมาคมฌาปนกิจ (ส.ส.ค.)"]) {
      expect(defuseBareDomains(text), text).toBe(text);
    }
  });

  it("leaves a real link alone, because it has already been allowed", () => {
    // By the time this runs the allowlist has had its say. Breaking the host
    // of a link staff entered deliberately would stop it working.
    const text = "กรอกที่ https://forms.gle/abc123 ได้เลยค่ะ";
    expect(defuseBareDomains(text)).toBe(text);
  });

  it("still defuses prose either side of an allowed link", () => {
    const out = defuseBareDomains("ดูที่ https://forms.gle/x หรือเมล nktsc.org@gmail.com");
    expect(out).toContain("https://forms.gle/x");
    expect(out).toContain(`nktsc${JOINER}.org`);
  });
});

describe("stripMarkdown", () => {
  it("removes the asterisks members were being shown", () => {
    // LINE renders no markdown, so this reached her as written.
    expect(stripMarkdown("📞 **ติดต่อสำนักงานสหกรณ์:**")).toBe("📞 ติดต่อสำนักงานสหกรณ์:");
  });

  it("removes bold from a stretch that spans a line break", () => {
    expect(stripMarkdown("**โทร 042-411334,\n042-423355**")).toBe(
      "โทร 042-411334,\n042-423355"
    );
  });

  it("keeps both halves of a link", () => {
    // Dropping either the words or where they point loses something.
    expect(stripMarkdown("[แบบฟอร์ม](https://forms.gle/abc)")).toBe(
      "แบบฟอร์ม https://forms.gle/abc"
    );
  });

  it("leaves a bullet alone", () => {
    // A line starting "* " is a bullet, and members read it as one. It is
    // the paired emphasis that arrives as litter.
    const text = "* โทร 042-411334\n* โทร 042-423355";
    expect(stripMarkdown(text)).toBe(text);
  });

  it("removes headings, code marks and underscores", () => {
    expect(stripMarkdown("## หัวข้อ")).toBe("หัวข้อ");
    expect(stripMarkdown("เลขบัญชี `413-1-00127-6`")).toBe("เลขบัญชี 413-1-00127-6");
    expect(stripMarkdown("__สำคัญ__")).toBe("สำคัญ");
  });

  it("leaves ordinary text untouched", () => {
    const text = "รับสลิปโอนเงิน 200,000 บาท เข้าบัญชีสหกรณ์เรียบร้อยค่ะ";
    expect(stripMarkdown(text)).toBe(text);
  });
});

describe("sanitiseReplyText", () => {
  it("handles the reply that carried the advert, end to end", () => {
    const out = sanitiseReplyText("📧 **nktsc.org@gmail.com**");
    expect(out).toBe(`📧 nktsc${JOINER}.org@gmail${JOINER}.com`);
    expect(out).not.toContain("*");
  });

  it("still strips a link no host allows", () => {
    // The allowlist is unchanged; this only checks it still runs.
    expect(sanitiseReplyText("ดูที่ https://example.com/x")).toContain("[ลิงก์ถูกลบ");
  });

  it("unwraps a markdown link before the allowlist judges it", () => {
    // Ordered on purpose: wrapped in [ ]( ), the URL would not have matched.
    expect(sanitiseReplyText("[เว็บ](https://example.com/x)")).toContain("[ลิงก์ถูกลบ");
  });

  it("keeps an allowed host working through every step", () => {
    const out = sanitiseReplyText("[กรอกที่นี่](https://forms.gle/abc)", new Set(["forms.gle"]));
    expect(out).toBe("กรอกที่นี่ https://forms.gle/abc");
  });
});
