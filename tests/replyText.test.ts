import { describe, expect, it } from "vitest";
import {
  DOMAIN_REMOVED,
  EMAIL_REMOVED,
  sanitiseReplyText,
  stripBareDomains,
  stripMarkdown,
} from "../lib/replyText";

describe("stripBareDomains", () => {
  // The advert appeared twice with a defence in place. The first hid an
  // invisible U+2060 inside the address in the knowledge entry, and the model
  // retyped the address, losing it. The second put the same character into
  // the finished reply, where nothing can retype it — it reached LINE intact
  // and LINE unfurled the domain anyway. So the address is removed, not
  // decorated: it is a domain, and there is no way to write a domain that a
  // matcher looking for domains will not find.
  it("takes the whole address out, not half of it", () => {
    expect(stripBareDomains("อีเมล nktsc.org@gmail.com")).toBe(`อีเมล ${EMAIL_REMOVED}`);
  });

  it("leaves no domain behind for the client to fetch", () => {
    const out = stripBareDomains("ติดต่อ nktsc.org@gmail.com หรือดูที่ nktsc.org");
    expect(out).not.toContain("nktsc.org");
    expect(out).not.toContain("gmail.com");
  });

  it("removes a bare domain with no address around it", () => {
    expect(stripBareDomains("ดูที่ nktscoop.com ค่ะ")).toBe(`ดูที่ ${DOMAIN_REMOVED} ค่ะ`);
  });

  it("does not touch an amount, a time, or a filename", () => {
    // All of these contain a dot and none of them is a domain.
    for (const text of ["ยอด 1,234.56 บาท", "ไม่เกิน 15.00 น.", "ไฟล์ รายการหัก.xlsx"]) {
      expect(stripBareDomains(text), text).toBe(text);
    }
  });

  it("does not touch a Thai abbreviation written with dots", () => {
    // น.ส., ส.ส.ค. — mangling these would be worse than the advert.
    for (const text of ["น.ส.กฤตยา ภักดีบรรดิษฐ์", "สมาคมฌาปนกิจ (ส.ส.ค.)"]) {
      expect(stripBareDomains(text), text).toBe(text);
    }
  });

  it("does not touch the office telephone numbers, which are the answer now", () => {
    const phones = "โทร 042-411334, 042-423355, 042-420746";
    expect(stripBareDomains(phones)).toBe(phones);
  });

  it("leaves a real link alone, because it has already been allowed", () => {
    // By the time this runs the allowlist has had its say. Breaking the host
    // of a link staff entered deliberately would stop it working.
    const text = "กรอกที่ https://forms.gle/abc123 ได้เลยค่ะ";
    expect(stripBareDomains(text)).toBe(text);
  });

  it("still strips prose either side of an allowed link", () => {
    const out = stripBareDomains("ดูที่ https://forms.gle/x หรือเมล nktsc.org@gmail.com");
    expect(out).toContain("https://forms.gle/x");
    expect(out).not.toContain("nktsc.org");
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
    expect(out).toBe(`📧 ${EMAIL_REMOVED}`);
    expect(out).not.toContain("*");
  });

  it("clears the whole real message that carried it", () => {
    // Verbatim from the conversation on 11 Sep, advert card and all.
    const real =
      "ขออภัยค่ะ ข้อมูลที่สมาชิกให้มาไม่ตรงกับทะเบียนสมาชิกของสหกรณ์ " +
      "สมาชิกโปรดติดต่อสำนักงานสหกรณ์โดยตรงได้ที่เบอร์โทรศัพท์ 042-411334, " +
      "042-423355, 042-420746 หรืออีเมล nktsc.org@gmail.com ค่ะ";
    const out = sanitiseReplyText(real);
    expect(out).not.toContain("nktsc.org");
    expect(out).not.toContain("gmail.com");
    expect(out).toContain("042-411334, 042-423355, 042-420746");
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
