// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/zip.ts — minimal READ-ONLY ZIP reader (enough for .xlsx).
//
// Reads the central directory (authoritative sizes, so streamed archives that
// leave 0/0 in the local header still work), then inflates each entry.
// Supports STORE (0) and DEFLATE (8) — the only two methods Excel/Numbers/
// LibreOffice/Google Sheets emit. Never writes, never executes anything.
// ════════════════════════════════════════════════════════════════════════════
import { inflateRaw } from "./inflate";
import { utf8Decode } from "./text";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;

export class ZipArchive {
  private data: Uint8Array;
  private dv: DataView;
  readonly entries: Map<string, ZipEntry> = new Map();

  constructor(data: Uint8Array) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.readCentralDirectory();
  }

  private u16(p: number): number {
    return this.dv.getUint16(p, true);
  }
  private u32(p: number): number {
    return this.dv.getUint32(p, true);
  }

  private readCentralDirectory(): void {
    const n = this.data.length;
    if (n < 22) throw new ZipError("file is too small to be a ZIP/XLSX archive");
    // EOCD lives in the last 64KiB + 22 bytes; scan backwards for its signature.
    let eocd = -1;
    const min = Math.max(0, n - 22 - 0xffff);
    for (let p = n - 22; p >= min; p--) {
      if (this.u32(p) === EOCD_SIG) {
        eocd = p;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("not a ZIP archive (no end-of-central-directory record)");

    let count = this.u16(eocd + 10);
    let cdOffset = this.u32(eocd + 16);
    // ZIP64: the 32-bit fields are saturated; read the ZIP64 EOCD instead.
    if (count === 0xffff || cdOffset === 0xffffffff) {
      let z = -1;
      for (let p = eocd - 20; p >= 0; p--) {
        if (this.u32(p) === ZIP64_EOCD_SIG) {
          z = p;
          break;
        }
      }
      if (z < 0) throw new ZipError("ZIP64 archive without a ZIP64 directory record");
      count = Number(this.dv.getBigUint64(z + 32, true));
      cdOffset = Number(this.dv.getBigUint64(z + 48, true));
    }

    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n || this.u32(p) !== CEN_SIG) break;
      const flags = this.u16(p + 8);
      const method = this.u16(p + 10);
      let compressedSize = this.u32(p + 20);
      let uncompressedSize = this.u32(p + 24);
      const nameLen = this.u16(p + 28);
      const extraLen = this.u16(p + 30);
      const commentLen = this.u16(p + 32);
      let localHeaderOffset = this.u32(p + 42);
      const rawName = this.data.subarray(p + 46, p + 46 + nameLen);
      // Bit 11 = UTF-8 names. Older writers use CP437; entry names inside an
      // .xlsx are pure ASCII paths, so UTF-8 decoding is always safe here.
      const name = utf8Decode(rawName);

      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        // ZIP64 extra field (0x0001) carries the real values, in this order.
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = this.u16(e);
          const size = this.u16(e + 2);
          let q = e + 4;
          if (id === 0x0001) {
            if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(this.dv.getBigUint64(q, true)); q += 8; }
            if (compressedSize === 0xffffffff) { compressedSize = Number(this.dv.getBigUint64(q, true)); q += 8; }
            if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(this.dv.getBigUint64(q, true)); }
            break;
          }
          e += 4 + size;
        }
      }
      void flags;
      if (!name.endsWith("/")) {
        this.entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (this.entries.size === 0) throw new ZipError("ZIP archive contains no readable entries");
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Declared uncompressed size of an entry (untrusted — use only as a budget hint). */
  sizeOf(name: string): number {
    return this.entries.get(name)?.uncompressedSize ?? 0;
  }

  /** Raw bytes of one entry, decompressed. `maxOutput` bounds a hostile entry. */
  read(name: string, maxOutput?: number): Uint8Array {
    const e = this.entries.get(name);
    if (!e) throw new ZipError(`entry not found in archive: ${name}`);
    const lh = e.localHeaderOffset;
    if (this.u32(lh) !== LOC_SIG) throw new ZipError(`corrupt local header for ${name}`);
    const nameLen = this.u16(lh + 26);
    const extraLen = this.u16(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const body = this.data.subarray(start, start + e.compressedSize);
    if (e.method === 0) return body;
    if (e.method === 8) return maxOutput === undefined ? inflateRaw(body, e.uncompressedSize) : inflateRaw(body, e.uncompressedSize, maxOutput);
    throw new ZipError(`unsupported compression method ${e.method} in ${name}`);
  }

  /** UTF-8 text of one entry. */
  readText(name: string, maxOutput?: number): string {
    return utf8Decode(this.read(name, maxOutput));
  }
}
