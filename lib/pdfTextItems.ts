// The text pdf.js finds on each page of a PDF, with where it sits — for
// reading the printed share-and-debt report in the browser
// (lib/shareDebtPdf.ts). Browser only: pdf.js runs in a worker so a 900-page
// file does not freeze the page.

import type { PdfTextItem } from "./shareDebtPdf";

let worker: Worker | null = null;

export async function readPdfTextItems(
  file: File,
  onPage?: (page: number, pages: number) => void
): Promise<PdfTextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  if (!worker) {
    worker = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const items: PdfTextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        items.push({ page: p, x: it.transform[4], y: it.transform[5], width: it.width, text: it.str });
      }
      page.cleanup();
      onPage?.(p, doc.numPages);
    }
    return items;
  } finally {
    await doc.destroy();
  }
}
