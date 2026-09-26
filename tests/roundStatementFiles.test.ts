import { describe, expect, it } from "vitest";
import {
  fileRemovalProblem,
  rowsOfFile,
  summarizeStatementFiles,
  type FileTransfer,
} from "../lib/roundStatementFiles";

let n = 0;
const row = (over: Partial<FileTransfer> = {}): FileTransfer => ({
  id: `t${++n}`,
  account: "413",
  branch: "หนองคาย",
  sourceFile: "413statement26.xls",
  fingerprint: `fp${n}`,
  amount: 100,
  transferredAt: new Date("2026-09-25T03:00:00Z"),
  ...over,
});

describe("summarizeStatementFiles", () => {
  it("gives one row per file with its date range, line count and total", () => {
    const files = summarizeStatementFiles([
      row({ transferredAt: new Date("2026-09-25T03:00:00Z") }),
      row({ transferredAt: new Date("2026-09-26T03:00:00Z"), amount: 250.5 }),
      row({ sourceFile: "413statement25.xls", transferredAt: new Date("2026-09-24T03:00:00Z") }),
    ]);
    expect(files).toEqual([
      expect.objectContaining({
        sourceFile: "413statement26.xls",
        transfers: 2,
        amount: 350.5,
        from: "2026-09-25",
        to: "2026-09-26",
        bridged: false,
      }),
      expect.objectContaining({ sourceFile: "413statement25.xls", transfers: 1 }),
    ]);
  });

  it("counts a split or set-aside piece as part of its line, not a line of its own", () => {
    const [file] = summarizeStatementFiles([
      row({ fingerprint: "a", amount: 600 }),
      row({ fingerprint: "a::split:x", amount: 400 }),
      row({ fingerprint: "a::aside:y", amount: 390 }),
    ]);
    expect(file.transfers).toBe(1);
    expect(file.amount).toBe(1390);
  });

  it("lists rows bridged from the daily page apart from the file of the same name", () => {
    const files = summarizeStatementFiles([
      row({ fingerprint: "real" }),
      row({ fingerprint: "line:daily" }),
    ]);
    expect(files.map((f) => [f.sourceFile, f.bridged])).toEqual([
      ["413statement26.xls", false],
      ["413statement26.xls", true],
    ]);
  });

  it("leaves cash out — it was never a file", () => {
    expect(summarizeStatementFiles([row({ account: "cash", sourceFile: null })])).toEqual([]);
  });
});

describe("rowsOfFile", () => {
  it("takes the file's lines and their pieces, not another file or a bridged row", () => {
    const rows = [
      row({ fingerprint: "a" }),
      row({ fingerprint: "a::split:x" }),
      row({ fingerprint: "b", sourceFile: "413statement25.xls" }),
      row({ fingerprint: "c", account: "447" }),
      row({ fingerprint: "line:d" }),
    ];
    expect(rowsOfFile(rows, "413", "413statement26.xls").map((r) => r.fingerprint)).toEqual([
      "a",
      "a::split:x",
    ]);
  });

  it("finds a file uploaded before names were kept", () => {
    const rows = [row({ fingerprint: "a", sourceFile: null }), row({ fingerprint: "b" })];
    expect(rowsOfFile(rows, "413", null).map((r) => r.fingerprint)).toEqual(["a"]);
  });
});

describe("fileRemovalProblem", () => {
  it("allows removal when nothing points at the rows", () => {
    expect(fileRemovalProblem({ carried: 0, setAside: 0 })).toBeNull();
  });

  it("refuses while money from the file pays a carried debt", () => {
    expect(fileRemovalProblem({ carried: 2, setAside: 0 })).toMatch(/ชำระข้ามเดือน/);
  });

  it("refuses while a set-aside piece has a transaction filed against it", () => {
    expect(fileRemovalProblem({ carried: 0, setAside: 1 })).toMatch(/รวมกลับ/);
  });
});
