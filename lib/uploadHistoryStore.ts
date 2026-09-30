import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { PreviousUpload } from "@/lib/uploadHistory";

export async function fileHash(file: File): Promise<string> {
  return createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
}

// This round's earlier uploads of the same file — by content, or by name.
export async function previousUploads(roundId: string, file: File): Promise<PreviousUpload[]> {
  const hash = await fileHash(file);
  const rows = await prisma.statementFileUpload.findMany({
    where: { roundId, OR: [{ fileHash: hash }, { fileName: file.name }] },
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    kind: r.kind,
    fileName: r.fileName,
    uploadedAt: r.uploadedAt.toISOString(),
    sameContent: r.fileHash === hash,
  }));
}

// Best-effort: the upload itself has already been applied, and a history row
// that failed to write must not turn it into an error.
export async function rememberUpload(roundId: string, file: File, kind: "results" | "list"): Promise<void> {
  try {
    await prisma.statementFileUpload.create({
      data: { roundId, kind, fileName: file.name, fileHash: await fileHash(file) },
    });
  } catch (err) {
    console.error("upload history not written", err);
  }
}
