// The order of the units list (🏢 หน่วยงานที่โอนแทนสมาชิก): by the name staff
// gave each unit, in Thai order. The database sorts by code point, which put
// every unit still under the bank's English text ("KALASIN EDUCA / …",
// "Office of Utta / …") ahead of the ones staff had named — and a Thai name
// like "รร.อนุบาลอุดรธานี" after all of them. Names staff wrote in Thai come
// first, in ก-ฮ order; the ones still read off the statement follow.
const startsThai = (name: string) => /^[฀-๿]/.test(name.trim());

export function compareUnitNames(a: string, b: string): number {
  const ta = startsThai(a);
  const tb = startsThai(b);
  if (ta !== tb) return ta ? -1 : 1;
  return a.trim().localeCompare(b.trim(), "th", { numeric: true, sensitivity: "base" });
}
