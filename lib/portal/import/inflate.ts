// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/inflate.ts — pure-TypeScript RAW DEFLATE decoder (RFC 1951).
//
// WHY THIS EXISTS (deliberate dependency decision):
//   package.json has NO xlsx/zip/zlib library, and adding one (xlsx ≈ 7 MB,
//   exceljs ≈ 12 MB) for an import screen is not justified. .xlsx is just a ZIP
//   of XML, and the only hard part of reading a ZIP is DEFLATE.
//   node:zlib exists on the server but NOT in the browser, and
//   DecompressionStream exists in the browser but is async and absent on older
//   Safari — a split implementation would mean two code paths and two sets of
//   bugs. ONE pure decoder is identical in Node and in the browser, synchronous,
//   and directly testable against zlib-produced fixtures (tests do exactly that
//   for stored, fixed-Huffman and dynamic-Huffman blocks).
// ════════════════════════════════════════════════════════════════════════════

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huff {
  /** counts[n] = number of codes of length n */
  counts: Int32Array;
  /** symbols sorted by (code length, symbol) — canonical Huffman order */
  symbols: Int32Array;
}

export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InflateError";
  }
}

function buildHuff(lengths: Int32Array | number[], n: number): Huff {
  const counts = new Int32Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Int32Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

class BitReader {
  private buf: Uint8Array;
  pos = 0;
  private val = 0;
  private cnt = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  bits(need: number): number {
    while (this.cnt < need) {
      if (this.pos >= this.buf.length) throw new InflateError("unexpected end of deflate stream");
      this.val |= this.buf[this.pos++] << this.cnt;
      this.cnt += 8;
    }
    const out = this.val & ((1 << need) - 1);
    this.val >>>= need;
    this.cnt -= need;
    return out;
  }

  /** Drop the partial byte (used before a stored block). */
  align(): void {
    this.val = 0;
    this.cnt = 0;
  }

  bytesAt(len: number): Uint8Array {
    if (this.pos + len > this.buf.length) throw new InflateError("stored block overruns input");
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  decode(h: Huff): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= this.bits(1);
      const count = h.counts[len];
      if (code - first < count) return h.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError("invalid Huffman code");
  }
}

class Sink {
  private buf: Uint8Array;
  private readonly max: number;
  len = 0;

  constructor(initial: number, max: number) {
    this.max = max;
    this.buf = new Uint8Array(Math.max(1024, Math.min(initial, max)));
  }

  private grow(extra: number): void {
    if (this.len + extra > this.max) {
      throw new InflateError(`decompressed size exceeds the ${Math.round(this.max / 1024 / 1024)} MiB limit`);
    }
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + extra) cap *= 2;
    if (cap > this.max) cap = this.max;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push(b: number): void {
    this.grow(1);
    this.buf[this.len++] = b;
  }

  pushBytes(bytes: Uint8Array): void {
    this.grow(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  copy(dist: number, length: number): void {
    if (dist > this.len) throw new InflateError("distance points before start of output");
    this.grow(length);
    let from = this.len - dist;
    for (let i = 0; i < length; i++) this.buf[this.len++] = this.buf[from++];
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

let FIXED_LIT: Huff | null = null;
let FIXED_DIST: Huff | null = null;
function fixedTables(): { lit: Huff; dist: Huff } {
  if (!FIXED_LIT || !FIXED_DIST) {
    const l = new Int32Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    FIXED_LIT = buildHuff(l, 288);
    const d = new Int32Array(30).fill(5);
    FIXED_DIST = buildHuff(d, 30);
  }
  return { lit: FIXED_LIT, dist: FIXED_DIST };
}

/**
 * Hard ceiling on decompressed output (64 MiB). The declared size in a ZIP is
 * attacker-controlled, so a 20 KB "spreadsheet" can claim — and actually
 * produce — gigabytes. Without this cap a malicious upload is an out-of-memory
 * kill of the whole server process; with it, it is a 400 with an Arabic message.
 */
export const MAX_INFLATE_OUTPUT = 64 * 1024 * 1024;

/** Decompress a raw DEFLATE stream (no zlib/gzip header). */
export function inflateRaw(input: Uint8Array, expectedSize: number = 0, maxOutput: number = MAX_INFLATE_OUTPUT): Uint8Array {
  const br = new BitReader(input);
  const hint = expectedSize > 0 && expectedSize <= maxOutput ? expectedSize : Math.min(input.length * 4, maxOutput);
  const out = new Sink(hint, maxOutput);
  for (;;) {
    const last = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.align();
      if (br.pos + 4 > input.length) throw new InflateError("truncated stored block header");
      const len = input[br.pos] | (input[br.pos + 1] << 8);
      const nlen = input[br.pos + 2] | (input[br.pos + 3] << 8);
      br.pos += 4;
      if ((len ^ 0xffff) !== nlen) throw new InflateError("stored block length check failed");
      out.pushBytes(br.bytesAt(len));
    } else if (type === 1 || type === 2) {
      let lit: Huff;
      let dist: Huff;
      if (type === 1) {
        const f = fixedTables();
        lit = f.lit;
        dist = f.dist;
      } else {
        const hlit = br.bits(5) + 257;
        const hdist = br.bits(5) + 1;
        const hclen = br.bits(4) + 4;
        const clen = new Int32Array(19);
        for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = br.bits(3);
        const clh = buildHuff(clen, 19);
        const lens = new Int32Array(hlit + hdist);
        let i = 0;
        while (i < lens.length) {
          const sym = br.decode(clh);
          if (sym < 16) {
            lens[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new InflateError("repeat with no previous length");
            const prev = lens[i - 1];
            let rep = 3 + br.bits(2);
            while (rep-- > 0 && i < lens.length) lens[i++] = prev;
          } else if (sym === 17) {
            let rep = 3 + br.bits(3);
            while (rep-- > 0 && i < lens.length) lens[i++] = 0;
          } else {
            let rep = 11 + br.bits(7);
            while (rep-- > 0 && i < lens.length) lens[i++] = 0;
          }
        }
        lit = buildHuff(lens.subarray(0, hlit), hlit);
        dist = buildHuff(lens.subarray(hlit), hdist);
      }
      for (;;) {
        const sym = br.decode(lit);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new InflateError("invalid length symbol");
          const length = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
          const ds = br.decode(dist);
          if (ds >= DIST_BASE.length) throw new InflateError("invalid distance symbol");
          const d = DIST_BASE[ds] + br.bits(DIST_EXTRA[ds]);
          out.copy(d, length);
        }
      }
    } else {
      throw new InflateError("invalid deflate block type");
    }
    if (last) break;
  }
  return out.result();
}
