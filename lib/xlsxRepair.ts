import zlib from "zlib";

// The bank's statement exports arrive in three shapes, and only one of them
// is a file a normal reader will open:
//
//   1. A genuine old BIFF .xls — an OLE compound file, not a zip at all.
//   2. A proper xlsx (often still named .xls). Reads directly.
//   3. An xlsx whose central directory is missing or truncated. The entries
//      are all there, but every zip reader refuses it outright because the
//      index at the end of the file is what tells it where they are.
//
// Shape 3 is why staff were being told to re-save the file in Excel by hand
// every month: Excel repairs it silently on open. The cooperative's own local
// workflow does the same repair in Python (statement-reconcile's
// zip_repair.py); this is that logic, so the dashboard accepts the same files
// the local scripts already do.

const LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CENTRAL_HEADER = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const DATA_DESCRIPTOR = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

// Readers take a plain ArrayBuffer, while a Node Buffer is a view onto a pool
// it shares with other allocations — so hand them a copy of just these bytes.
export function toArrayBuffer(data: Buffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export function looksLikeZip(data: Buffer): boolean {
  return data.subarray(0, 4).equals(LOCAL_HEADER);
}

// D0 CF 11 E0 A1 B1 1A E1 — the OLE compound file signature every real .xls
// (and .doc, .ppt) starts with. Worth telling apart from a corrupt xlsx
// because the answer for staff is different: this one genuinely has to be
// re-saved as .xlsx, no amount of repairing will help.
export function looksLikeLegacyXls(data: Buffer): boolean {
  return data
    .subarray(0, 8)
    .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

let crcTable: Uint32Array | null = null;

// Written out rather than using zlib.crc32, which only exists on newer Node
// versions — this file has to work on whatever the host happens to run.
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface LocalEntry {
  offset: number;
  name: string;
  headerLength: number;
  flag: number;
  compression: number;
  compressedSize: number;
}

function readLocalEntries(data: Buffer): LocalEntry[] {
  const entries: LocalEntry[] = [];
  let pos = 0;

  for (;;) {
    const at = data.indexOf(LOCAL_HEADER, pos);
    if (at === -1 || at + 30 > data.length) break;

    const flag = data.readUInt16LE(at + 6);
    const compression = data.readUInt16LE(at + 8);
    const compressedSize = data.readUInt32LE(at + 18);
    const nameLength = data.readUInt16LE(at + 26);
    const extraLength = data.readUInt16LE(at + 28);
    const name = data.subarray(at + 30, at + 30 + nameLength).toString("utf8");

    entries.push({
      offset: at,
      name,
      headerLength: 30 + nameLength + extraLength,
      flag,
      compression,
      compressedSize,
    });
    // Step past this signature only — an entry's compressed bytes can
    // contain the same four bytes, and skipping the whole entry on a size
    // field we may not trust would lose everything after a bad one.
    pos = at + 4;
  }

  return entries;
}

function contentOf(data: Buffer, entry: LocalEntry, nextOffset: number): Buffer {
  const start = entry.offset + entry.headerLength;

  let raw: Buffer;
  if (entry.flag & 0x08) {
    // Sizes were not known when the file was written; they follow the data in
    // a descriptor, so the content runs up to that marker.
    const descriptor = data.indexOf(DATA_DESCRIPTOR, start);
    raw =
      descriptor !== -1 && descriptor < nextOffset
        ? data.subarray(start, descriptor)
        : data.subarray(start, nextOffset);
  } else {
    raw = data.subarray(start, start + entry.compressedSize);
  }

  if (entry.compression !== 8) return raw;
  try {
    return zlib.inflateRawSync(raw);
  } catch {
    // A truncated final entry still inflates partially in practice, and a
    // sheet short of its last rows beats refusing the whole file.
    try {
      return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      return raw;
    }
  }
}

// Rebuilds a readable zip from the entries found in a file whose central
// directory is gone. Entries are written uncompressed: this output only has
// to survive being handed straight to a reader, never to be stored.
export function repairZip(data: Buffer): Buffer {
  const entries = readLocalEntries(data);
  if (entries.length === 0) {
    throw new Error("no zip entries found");
  }

  const centralStart = data.indexOf(CENTRAL_HEADER);
  const contentEnd = centralStart === -1 ? data.length : centralStart;

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry, index) => {
    const nextOffset = index + 1 < entries.length ? entries[index + 1].offset : contentEnd;
    const content = contentOf(data, entry, nextOffset);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(content);

    const local = Buffer.alloc(30 + name.length);
    LOCAL_HEADER.copy(local, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags — sizes are known now
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    CENTRAL_HEADER.copy(central, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, content);
    centrals.push(central);
    offset += local.length + content.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}
