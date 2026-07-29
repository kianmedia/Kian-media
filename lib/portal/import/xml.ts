// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/xml.ts — the tiny slice of XML reading that .xlsx needs.
// Office XML is machine-generated and highly regular, so a scanner is enough;
// we never need a full DOM. Entity handling is complete (named, decimal, hex,
// and Excel's own _xHHHH_ escapes) because Arabic content must survive intact.
// ════════════════════════════════════════════════════════════════════════════

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode XML entities. Unknown entities are left as-is (never dropped). */
export function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const v = NAMED[body];
    return v === undefined ? m : v;
  });
}

/**
 * Undo Excel's `_xHHHH_` escaping of characters that are illegal in XML.
 * A literal run that merely LOOKS like an escape is itself escaped by Excel as
 * `_x005F_` + the run, so the first alternation branch restores it verbatim.
 */
export function unescapeXlsxText(s: string): string {
  if (s.indexOf("_x") === -1) return s;
  return s.replace(/_x005F_(_x[0-9A-Fa-f]{4}_)|_x([0-9A-Fa-f]{4})_/g, (_m, literal: string | undefined, hex: string | undefined) =>
    literal !== undefined ? literal : String.fromCharCode(parseInt(hex as string, 16)),
  );
}

export function xmlText(s: string): string {
  return unescapeXlsxText(decodeEntities(s));
}

/** Parse the attributes of a single start tag body (`a="1" b='2'`). */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4] ?? "");
  return out;
}

export interface XmlElement {
  attrText: string;
  inner: string;
}

/**
 * Collect every `<name …>…</name>` element (including self-closing) at any
 * depth, WITHOUT nesting support — sufficient for the flat Office XML shapes we
 * read (si, row, c, sheet, numFmt, xf).
 * Returns an ARRAY rather than a generator: this repo compiles to ES5, where
 * iterating a generator would need downlevelIteration.
 */
export function elements(xml: string, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const re = new RegExp(`<${name}(\\s[^>]*?)?(/>|>)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrText = m[1] ?? "";
    if (m[2] === "/>") {
      out.push({ attrText, inner: "" });
      continue;
    }
    const close = xml.indexOf(`</${name}>`, re.lastIndex);
    const inner = close === -1 ? xml.slice(re.lastIndex) : xml.slice(re.lastIndex, close);
    out.push({ attrText, inner });
    if (close === -1) break;
    re.lastIndex = close + name.length + 3;
  }
  return out;
}
