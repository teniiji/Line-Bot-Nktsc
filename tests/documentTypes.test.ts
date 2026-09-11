import { describe, expect, it } from "vitest";
import { NO_DOCUMENT, staffHelpDocumentFields } from "../lib/documentTypes";

describe("staffHelpDocumentFields", () => {
  it("leaves a document the member already sent alone", () => {
    // She sent a salary certificate; flag_supporting_document filed it; then
    // the model reached for request_staff_help instead of
    // submit_service_purpose and the row was overwritten. The request reached
    // staff reading "ไม่มีเอกสารแนบ" with the certificate attached to nothing.
    expect(staffHelpDocumentFields("สลิปเงินเดือน")).toEqual({});
  });

  it("leaves any of the other document kinds alone too", () => {
    for (const kind of ["สำเนาบัตรประชาชน", "สำเนาทะเบียนบ้าน", "ทะเบียนสมรส", "เอกสารประกอบอื่นๆ"]) {
      expect(staffHelpDocumentFields(kind), kind).toEqual({});
    }
  });

  it("marks a request that genuinely has no document", () => {
    // The case this tool was written for: a forgotten password, reported as
    // text with nothing attached.
    expect(staffHelpDocumentFields(null)).toEqual({
      documentType: NO_DOCUMENT,
      imageUrl: null,
      imageIsPdf: false,
    });
  });

  it("is happy to rewrite a row that already said it had none", () => {
    // Two staff-help requests in a row is not a document being lost.
    expect(staffHelpDocumentFields(NO_DOCUMENT)).toEqual({
      documentType: NO_DOCUMENT,
      imageUrl: null,
      imageIsPdf: false,
    });
  });
});
