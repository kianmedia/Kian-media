// ════════════════════════════════════════════════════════════════════════════
// tests/import_engine_loader.js — shared test harness for the import engine.
// (NOT a test file: `node --test tests/` only picks up *.test.js, verified.)
//
// Two jobs:
//   1) loadTs(): require() a TypeScript module for real. The engine is pure
//      logic, so its tests must EXECUTE it — asserting on source text would
//      prove nothing about whether an Arabic header actually maps or whether a
//      key is actually stable. Sucrase is already in the tree (a tailwindcss
//      dependency) and is used here for dev-time transpilation only.
//   2) makeXlsx(): build a REAL .xlsx (ZIP + DEFLATE via node:zlib) so the
//      hand-written inflate/zip/xlsx readers are tested against bytes produced
//      by an independent implementation, not against their own output.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");

let transform = null;
try {
  ({ transform } = require("sucrase"));
} catch {
  transform = null;
}

/** true when TypeScript modules can be loaded in this environment. */
const TS_AVAILABLE = transform !== null;

const cache = new Map();
const EXTS = ["", ".ts", ".tsx", ".js", ".json", "/index.ts", "/index.js"];

function resolveSpec(spec, fromDir) {
  let base = null;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".") || spec.startsWith("/")) base = path.resolve(fromDir, spec);
  if (base === null) return null;
  for (const ext of EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  throw new Error(`cannot resolve ${spec} from ${fromDir}`);
}

/** Load a .ts/.json module by repo-relative path, e.g. "lib/portal/import/keys.ts". */
function loadTs(relPath) {
  const file = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  if (cache.has(file)) return cache.get(file);
  if (file.endsWith(".json")) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    cache.set(file, json);
    return json;
  }
  if (!TS_AVAILABLE) throw new Error("sucrase is unavailable; cannot load TypeScript in tests");
  const src = fs.readFileSync(file, "utf8");
  const { code } = transform(src, { transforms: ["typescript", "imports"], filePath: file });
  // NOTE: deliberately not named `module` — assigning to that identifier trips
  // @next/next/no-assign-module-variable. The object is still passed in as the
  // `module` parameter of the generated function below, so CommonJS interop is
  // unchanged.
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const dir = path.dirname(file);
  const localRequire = (spec) => {
    const resolved = resolveSpec(spec, dir);
    return resolved === null ? require(spec) : loadTs(resolved);
  };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", code);
  fn(mod.exports, localRequire, mod, file, dir);
  cache.set(file, mod.exports);
  return mod.exports;
}

// ─── minimal .xlsx writer (test fixtures only) ─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipBuffer(files, { store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const useStore = store || f.store;
    const body = useStore ? raw : zlib.deflateRawSync(raw, { level: f.level ?? 9 });
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colName = (i) => {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * Build a real .xlsx.
 * Cell values: a string → shared string; {n} → number; {d} → date-formatted
 * number (style 1); {inline} → inline string.
 */
function makeXlsx(rows, { sheetName = "الخطة", store = false } = {}) {
  const shared = [];
  const sharedIndex = new Map();
  const sharedOf = (s) => {
    if (!sharedIndex.has(s)) {
      sharedIndex.set(s, shared.length);
      shared.push(s);
    }
    return sharedIndex.get(s);
  };
  const rowXml = rows
    .map((cells, r) => {
      const cellXml = cells
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "object" && v.n !== undefined) return `<c r="${ref}"><v>${v.n}</v></c>`;
          if (typeof v === "object" && v.d !== undefined) return `<c r="${ref}" s="1"><v>${v.d}</v></c>`;
          if (typeof v === "object" && v.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
          return `<c r="${ref}" t="s"><v>${sharedOf(String(v))}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join("");

  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
    {
      name: "xl/sharedStrings.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
        .join("")}</sst>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
    },
  ];
  return new Uint8Array(zipBuffer(files, { store }));
}

module.exports = { ROOT, TS_AVAILABLE, loadTs, makeXlsx, zipBuffer, crc32 };
