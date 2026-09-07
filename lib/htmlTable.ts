// The fourth shape a bank "statement.xls" arrives in: an HTML table.
//
// The bank's web export writes a plain <table> and names it .xls. Excel opens
// it happily — it has understood HTML tables since the 90s — so nobody
// downloading one has any reason to think it is not a spreadsheet. Every
// actual spreadsheet reader refuses it, because it is not one.
//
// Parsed with regexes rather than a DOM library on purpose: this is one
// machine-generated table with no nesting, no scripts and one entity
// (&nbsp;), and the alternative is a dependency to read a file format we only
// ever meet in this exact shape. Cells come out as text, which is what the
// statement parsers already expect from Excel's own string cells.

// The document starts with a doctype, an <html>, or the table itself. Checked
// on the first bytes so a spreadsheet that merely mentions "<html" somewhere
// inside is not mistaken for one.
export function looksLikeHtml(data: Buffer): boolean {
  const head = data.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<table");
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/gi, (match) => ENTITIES[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cellText(html: string): string | null {
  const text = decodeEntities(
    html
      // A line break inside a cell is a space, not a join — otherwise two
      // values run together into one unreadable string.
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();

  // Empty cells come back as null to match what ExcelJS gives for a blank
  // cell, so the statement parsers see the same thing either way.
  return text === "" ? null : text;
}

const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;

// Reads every row of every table in the document, in document order — the
// bank splits the account header and the transactions into two sibling
// tables, and the statement parsers expect them one after the other exactly
// as the spreadsheet version has them.
export function parseHtmlTableRows(html: string): unknown[][] {
  const rows: unknown[][] = [];

  ROW.lastIndex = 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = ROW.exec(html)) !== null) {
    const cells: unknown[] = [];

    CELL.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = CELL.exec(rowMatch[1])) !== null) {
      cells.push(cellText(cellMatch[2]));

      // A spanned cell occupies several columns, so the ones after it have to
      // be held open — otherwise every value to its right shifts left and
      // lands under the wrong heading.
      const span = cellMatch[1].match(/colspan\s*=\s*["']?(\d+)/i);
      const width = span ? Number(span[1]) : 1;
      for (let extra = 1; extra < width; extra += 1) cells.push(null);
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}
