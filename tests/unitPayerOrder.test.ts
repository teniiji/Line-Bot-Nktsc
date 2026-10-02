import { describe, expect, it } from "vitest";
import { compareUnitNames } from "../lib/unitPayerOrder";

describe("compareUnitNames", () => {
  it("puts names staff gave in Thai first, in ก-ฮ order, then the statement's own text", () => {
    const names = [
      "Office of Utta / สำนักงานเขตพื้นที่การศึกษ",
      "รร.อนุบาลอุดรธานี",
      "KALASIN EDUCA / สำนักงานศึกษาธิการ จ.กาฬสิ",
      "กองการเจ้าหน้าที่",
      "สพป.เลย เขต 10",
      "สพป.เลย เขต 2",
    ];
    expect([...names].sort(compareUnitNames)).toEqual([
      "กองการเจ้าหน้าที่",
      "รร.อนุบาลอุดรธานี",
      "สพป.เลย เขต 2",
      "สพป.เลย เขต 10",
      "KALASIN EDUCA / สำนักงานศึกษาธิการ จ.กาฬสิ",
      "Office of Utta / สำนักงานเขตพื้นที่การศึกษ",
    ]);
  });
});
