// ════════════════════════════════════════════════════════════════════════════
// tests/fixtures/plpgsql.js — مُفسِّر صغير لجزء من PL/pgSQL يكفي **لتنفيذ**
// أجسام الدوالّ المشحونة في docs/*.sql بدل إعادة كتابة توقّعاتها بالجافاسكربت.
//
// لماذا مُفسِّر لا تعابير نمطية: اختبار يقول `assert.match(SQL, /can_move_deliverable/)`
// ينجح أيضًا لو صار الحارس `if false and not can_move_deliverable(...)`. الاختبار
// الذي يُشغّل النصّ نفسه يسقط عند أيّ قلب للمنطق أو حذف لفرع.
//
// المبدأ الحاكم: **لا تخمين**. أيّ بنية أو دالّة غير مدعومة ترفع استثناءً
// صريحًا (UnsupportedError) بدل تخطّيها بصمت — تخطٍّ صامت = اختبار أجوف.
//
// المنطق ثلاثيّ القيم (true/false/NULL) مقصود: انهيار NULL هو صنف الخطأ الذي
// سبّب حادثة fail-open حقيقية في هذا المستودع، ولا يمكن كشفه بمنطق JS الثنائيّ
// (`null || false` في JS = false، وفي SQL = NULL).
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const readSql = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** خطأ قاعدة بيانات (يُلتقط بـexception when others). */
class SqlError extends Error {
  constructor(msg) { super(msg); this.name = "SqlError"; this.sqlerrm = msg; }
}
/** بنية غير مدعومة في المُفسِّر — لا تُلتقط: تُفشل الاختبار بصوت عالٍ. */
class UnsupportedError extends Error {
  constructor(msg) { super(`UNSUPPORTED: ${msg}`); this.name = "UnsupportedError"; }
}

const isNull = (v) => v === null || v === undefined;

// ─── منطق ثلاثيّ القيم ──────────────────────────────────────────────────────
const or3 = (a, b) => (a === true || b === true) ? true : (isNull(a) || isNull(b)) ? null : false;
const and3 = (a, b) => (a === false || b === false) ? false : (isNull(a) || isNull(b)) ? null : true;
const not3 = (a) => isNull(a) ? null : a !== true;

// ════════════════════════════════════════════════════════════════════════════
// 1) المُحلّل المعجميّ
// ════════════════════════════════════════════════════════════════════════════

const OPS3 = ["->>"];
const OPS2 = [":=", "->", "||", "<>", "!=", "<=", ">=", "::", "=>"];
const OPS1 = ["=", "<", ">", "?", "%", "+", "-", "*", "/", "(", ")", ",", ";", "[", "]", ".", "@", "#"];

function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "-" && src[i + 1] === "-") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") {
      let j = i + 1, buf = "";
      while (j < n) {
        if (src[j] === "'" && src[j + 1] === "'") { buf += "'"; j += 2; continue; }
        if (src[j] === "'") break;
        buf += src[j++];
      }
      out.push({ t: "str", v: buf }); i = j + 1; continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(src.slice(i));
      if (m) {
        const tag = m[0];
        const e = src.indexOf(tag, i + tag.length);
        if (e < 0) throw new UnsupportedError(`dollar-quote غير مغلق: ${tag}`);
        out.push({ t: "str", v: src.slice(i + tag.length, e), dollar: tag });
        i = e + tag.length; continue;
      }
    }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < n && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: Number(src.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_؀-ۿ]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_$؀-ۿ]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) { out.push({ t: "op", v: three }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new UnsupportedError(`محرف غير معروف «${c}» عند ${i}`);
  }
  out.push({ t: "eof", v: "" });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 2) المُحلّل النحويّ — تعابير ثمّ جُمَل
// ════════════════════════════════════════════════════════════════════════════

const KW_STOP = new Set(["then", "loop", "end", "elsif", "else", "exception", "when", "from", "into", "using", "returning"]);

class Parser {
  constructor(tokens, src) { this.k = tokens; this.i = 0; this.src = src; }
  peek(o = 0) { return this.k[this.i + o]; }
  next() { return this.k[this.i++]; }
  atId(word) { const t = this.peek(); return t.t === "id" && t.v.toLowerCase() === word; }
  atOp(sym) { const t = this.peek(); return t.t === "op" && t.v === sym; }
  eatId(word) { if (this.atId(word)) { this.i++; return true; } return false; }
  eatOp(sym) { if (this.atOp(sym)) { this.i++; return true; } return false; }
  expectId(word) { if (!this.eatId(word)) throw new UnsupportedError(`توقّعت «${word}» فوجدت «${this.peek().v}»`); }
  expectOp(sym) { if (!this.eatOp(sym)) throw new UnsupportedError(`توقّعت «${sym}» فوجدت «${this.peek().v}»`); }

  // ── تعابير ──────────────────────────────────────────────────────────────
  parseExpr() { return this.parseOr(); }
  parseOr() {
    let l = this.parseAnd();
    while (this.atId("or")) { this.i++; l = { k: "or", l, r: this.parseAnd() }; }
    return l;
  }
  parseAnd() {
    let l = this.parseNot();
    while (this.atId("and")) { this.i++; l = { k: "and", l, r: this.parseNot() }; }
    return l;
  }
  parseNot() {
    if (this.atId("not")) { this.i++; return { k: "not", e: this.parseNot() }; }
    return this.parseCmp();
  }
  parseCmp() {
    let l = this.parseAdd();
    for (;;) {
      if (this.atId("is")) {
        this.i++;
        const neg = this.eatId("not");
        if (this.eatId("null")) { l = { k: "isnull", e: l, neg }; continue; }
        if (this.eatId("distinct")) { this.expectId("from"); l = { k: "distinct", l, r: this.parseAdd(), neg }; continue; }
        if (this.eatId("true")) { l = { k: "isbool", e: l, neg, want: true }; continue; }
        if (this.eatId("false")) { l = { k: "isbool", e: l, neg, want: false }; continue; }
        throw new UnsupportedError(`IS ${this.peek().v} غير مدعومة`);
      }
      if (this.atId("not") && this.peek(1).t === "id" && ["like", "in"].includes(this.peek(1).v.toLowerCase())) {
        this.i++;
        if (this.eatId("like")) { l = { k: "like", l, r: this.parseAdd(), neg: true }; continue; }
        this.expectId("in"); l = { k: "in", l, list: this.parseParenList(), neg: true }; continue;
      }
      if (this.atId("like")) { this.i++; l = { k: "like", l, r: this.parseAdd(), neg: false }; continue; }
      if (this.atId("in")) { this.i++; l = { k: "in", l, list: this.parseParenList(), neg: false }; continue; }
      if (this.atOp("=") || this.atOp("<>") || this.atOp("!=") || this.atOp("<") || this.atOp(">")
        || this.atOp("<=") || this.atOp(">=")) {
        const op = this.next().v;
        if (op === "=" && this.atId("any")) {
          this.i++; this.expectOp("("); const arr = this.parseExpr(); this.expectOp(")");
          l = { k: "anyof", l, arr }; continue;
        }
        l = { k: "cmp", op, l, r: this.parseAdd() };
        continue;
      }
      if (this.atOp("?")) { this.i++; l = { k: "haskey", l, r: this.parseAdd() }; continue; }
      return l;
    }
  }
  parseParenList() {
    this.expectOp("(");
    const items = [];
    let distinct = false;
    if (!this.atOp(")")) {
      do {
        if (this.atId("distinct")) { this.i++; distinct = true; }
        if (this.atOp("*")) { this.i++; items.push({ k: "star" }); continue; }
        items.push(this.parseExpr());
      } while (this.eatOp(","));
    }
    this.expectOp(")");
    items.distinct = distinct;
    return items;
  }
  parseAdd() {
    let l = this.parseUnary();
    for (;;) {
      if (this.atOp("||")) { this.i++; l = { k: "concat", l, r: this.parseUnary() }; continue; }
      if (this.atOp("+") || this.atOp("-")) { const op = this.next().v; l = { k: "arith", op, l, r: this.parseUnary() }; continue; }
      return l;
    }
  }
  parseUnary() {
    if (this.atOp("-")) { this.i++; return { k: "neg", e: this.parseUnary() }; }
    return this.parsePostfix();
  }
  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atOp("::")) { this.i++; e = { k: "cast", e, type: this.parseTypeName() }; continue; }
      if (this.atOp("->>") || this.atOp("->")) { const op = this.next().v; e = { k: "json", op, l: e, r: this.parsePrimary() }; continue; }
      return e;
    }
  }
  parseTypeName() {
    let t = this.next().v;
    while (this.atOp(".")) { this.i++; t = this.next().v; }
    if (this.atOp("[")) { this.i++; this.expectOp("]"); t += "[]"; }
    return String(t).toLowerCase();
  }
  parsePrimary() {
    const t = this.peek();
    if (t.t === "str") { this.i++; return { k: "str", v: t.v }; }
    if (t.t === "num") { this.i++; return { k: "num", v: t.v }; }
    if (this.atOp("(")) { this.i++; const e = this.parseExpr(); this.expectOp(")"); return e; }
    if (t.t === "id") {
      const low = t.v.toLowerCase();
      if (low === "true") { this.i++; return { k: "bool", v: true }; }
      if (low === "false") { this.i++; return { k: "bool", v: false }; }
      if (low === "null") { this.i++; return { k: "null" }; }
      if (low === "case") return this.parseCase();
      if (low === "exists" && this.peek(1).t === "op" && this.peek(1).v === "(") {
        this.i += 2;
        const start = this.i;
        let depth = 1;
        while (this.peek().t !== "eof") {
          if (this.atOp("(")) depth++;
          else if (this.atOp(")")) { depth--; if (depth === 0) break; }
          this.i++;
        }
        const query = this.textOf(start, this.i);
        this.expectOp(")");
        return { k: "exists", query };
      }
      if (low === "array" && this.peek(1).t === "op" && this.peek(1).v === "[") {
        this.i += 2;
        const items = [];
        if (!this.atOp("]")) { do { items.push(this.parseExpr()); } while (this.eatOp(",")); }
        this.expectOp("]");
        return { k: "arraylit", items };
      }
      // اسم مؤهَّل: a.b.c
      let name = this.next().v;
      while (this.atOp(".")) { this.i++; name += "." + this.next().v; }
      if (this.atOp("(")) {
        const args = this.parseParenList();
        return { k: "call", name: name.toLowerCase(), args };
      }
      return { k: "var", name };
    }
    throw new UnsupportedError(`تعبير غير متوقَّع عند «${t.v}»`);
  }
  parseCase() {
    this.expectId("case");
    const whens = [];
    let subject = null;
    if (!this.atId("when")) subject = this.parseExpr();
    while (this.eatId("when")) {
      const c = this.parseExpr();
      this.expectId("then");
      whens.push([c, this.parseExpr()]);
    }
    let els = null;
    if (this.eatId("else")) els = this.parseExpr();
    this.expectId("end");
    return { k: "case", subject, whens, els };
  }

  // ── جُمَل ───────────────────────────────────────────────────────────────
  parseBlock(stopWords) {
    const stmts = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "eof") return stmts;
      if (t.t === "id" && stopWords.includes(t.v.toLowerCase())) return stmts;
      if (this.eatOp(";")) continue;
      stmts.push(this.parseStatement());
    }
  }
  parseStatement() {
    const t = this.peek();
    const low = t.t === "id" ? t.v.toLowerCase() : "";
    if (low === "if") return this.parseIf();
    if (low === "begin") return this.parseBeginEnd();
    if (low === "return") { this.i++; if (this.eatOp(";")) return { s: "return", e: null }; const e = this.parseExpr(); this.eatOp(";"); return { s: "return", e }; }
    if (low === "raise") return this.parseRaise();
    if (low === "perform") {
      this.i++;
      const e = this.parseExpr();
      // ذيل اختياريّ: `perform f(...) from public.t alias where …` (تعميم على صفوف).
      const start = this.i;
      let depth = 0;
      while (this.peek().t !== "eof") {
        if (this.atOp("(")) depth++;
        else if (this.atOp(")")) depth--;
        else if (depth === 0 && this.atOp(";")) break;
        this.i++;
      }
      const tail = this.textOf(start, this.i);
      this.eatOp(";");
      return { s: "perform", e, tail: tail.trim() };
    }
    if (low === "null" && this.peek(1).t === "op" && this.peek(1).v === ";") { this.i += 2; return { s: "noop" }; }
    if (low === "foreach") return this.parseForeach();
    if (low === "for") return this.parseForSelect();
    if (low === "loop") return this.parseLoop();
    if (low === "exit") { this.i++; let cond = null; if (this.eatId("when")) cond = this.parseExpr(); this.eatOp(";"); return { s: "exit", cond }; }
    if (low === "continue") { this.i++; let cond = null; if (this.eatId("when")) cond = this.parseExpr(); this.eatOp(";"); return { s: "continue", cond }; }
    if (low === "get") { // get diagnostics v = row_count;
      this.i++; this.expectId("diagnostics");
      const target = this.next().v; this.expectOp("=");
      const what = this.next().v.toLowerCase(); this.eatOp(";");
      return { s: "diagnostics", target, what };
    }
    // إسناد: ident := expr;
    if (t.t === "id" && this.peek(1).t === "op" && this.peek(1).v === ":=") {
      const target = this.next().v; this.i++;
      const e = this.parseExpr(); this.eatOp(";");
      return { s: "assign", target, e };
    }
    // ما تبقّى (select/insert/update/delete/execute…) يُفوَّض إلى البيئة بنصّه الخام.
    return this.parseRawStatement();
  }
  parseIf() {
    this.expectId("if");
    const branches = [];
    let cond = this.parseExpr();
    this.expectId("then");
    let body = this.parseBlock(["elsif", "else", "end"]);
    branches.push([cond, body]);
    while (this.atId("elsif")) {
      this.i++; cond = this.parseExpr(); this.expectId("then");
      body = this.parseBlock(["elsif", "else", "end"]);
      branches.push([cond, body]);
    }
    let els = null;
    if (this.eatId("else")) els = this.parseBlock(["end"]);
    this.expectId("end"); this.expectId("if"); this.eatOp(";");
    return { s: "if", branches, els };
  }
  parseBeginEnd() {
    this.expectId("begin");
    const body = this.parseBlock(["exception", "end"]);
    let handler = null;
    if (this.eatId("exception")) {
      this.expectId("when");
      const conds = [this.next().v.toLowerCase()];
      while (this.eatId("or")) conds.push(this.next().v.toLowerCase());
      this.expectId("then");
      handler = { conds, body: this.parseBlock(["end", "when"]) };
      if (this.atId("when")) throw new UnsupportedError("معالج استثناء متعدّد غير مدعوم");
    }
    this.expectId("end"); this.eatOp(";");
    return { s: "block", body, handler };
  }
  parseRaise() {
    this.expectId("raise");
    const level = this.next().v.toLowerCase(); // exception | notice
    const parts = [];
    while (!this.atOp(";") && this.peek().t !== "eof") {
      if (this.eatOp(",")) continue;
      parts.push(this.parseExpr());
    }
    this.eatOp(";");
    return { s: "raise", level, parts };
  }
  parseForeach() {
    this.expectId("foreach");
    const v = this.next().v;
    this.expectId("in"); this.expectId("array");
    const arr = this.parseExpr();
    this.expectId("loop");
    const body = this.parseBlock(["end"]);
    this.expectId("end"); this.expectId("loop"); this.eatOp(";");
    return { s: "foreach", v, arr, body };
  }
  parseForSelect() {
    this.expectId("for");
    const v = this.next().v;
    this.expectId("in");
    const start = this.i;
    let depth = 0;
    while (this.peek().t !== "eof") {
      if (this.atOp("(")) depth++;
      if (this.atOp(")")) depth--;
      if (depth === 0 && this.atId("loop")) break;
      this.i++;
    }
    const query = this.textOf(start, this.i);
    this.expectId("loop");
    const body = this.parseBlock(["end"]);
    this.expectId("end"); this.expectId("loop"); this.eatOp(";");
    return { s: "forquery", v, query, body };
  }
  parseLoop() {
    this.expectId("loop");
    const body = this.parseBlock(["end"]);
    this.expectId("end"); this.expectId("loop"); this.eatOp(";");
    return { s: "loop", body };
  }
  parseRawStatement() {
    const start = this.i;
    let depth = 0;
    while (this.peek().t !== "eof") {
      if (this.atOp("(")) depth++;
      else if (this.atOp(")")) depth--;
      else if (depth === 0 && this.atOp(";")) break;
      this.i++;
    }
    const raw = this.textOf(start, this.i);
    const verb0 = (this.k[start].v || "").toLowerCase();
    // أهداف INTO تُلتقط كي تستطيع البيئة ملأها. في INSERT كلمة `into` تسبق اسم
    // الجدول ⇒ لا تُقرأ إلّا بعد `returning`.
    const into = [];
    let seenReturning = verb0 !== "insert";
    for (let j = start; j < this.i; j++) {
      const tk = this.k[j];
      if (tk.t === "id" && tk.v.toLowerCase() === "returning") { seenReturning = true; continue; }
      if (tk.t === "id" && tk.v.toLowerCase() === "into" && seenReturning) {
        let m = j + 1;
        for (;;) {
          const nt = this.k[m];
          if (!nt || nt.t !== "id") break;
          let nm = nt.v; m++;
          while (this.k[m] && this.k[m].t === "op" && this.k[m].v === ".") { m += 2; nm = this.k[m - 1].v; }
          into.push(nm);
          if (this.k[m] && this.k[m].t === "op" && this.k[m].v === ",") { m++; continue; }
          break;
        }
        break;
      }
    }
    this.eatOp(";");
    return { s: "raw", raw, into, verb: (this.k[start].v || "").toLowerCase() };
  }
  textOf(a, b) {
    return this.k.slice(a, b).map((t) => (t.t === "str" ? `'${t.v}'` : String(t.v))).join(" ");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3) التنفيذ
// ════════════════════════════════════════════════════════════════════════════

const BUILTIN = {
  coalesce: (...a) => { for (const v of a) if (!isNull(v)) return v; return null; },
  nullif: (a, b) => (a === b ? null : a),
  btrim: (a, chars) => {
    if (isNull(a)) return null;
    const s = String(a);
    if (isNull(chars)) return s.trim();
    const set = new Set(String(chars).split(""));
    let i = 0, j = s.length;
    while (i < j && set.has(s[i])) i++;
    while (j > i && set.has(s[j - 1])) j--;
    return s.slice(i, j);
  },
  lower: (a) => (isNull(a) ? null : String(a).toLowerCase()),
  upper: (a) => (isNull(a) ? null : String(a).toUpperCase()),
  length: (a) => (isNull(a) ? null : String(a).length),
  left: (a, n) => (isNull(a) ? null : String(a).slice(0, n)),
  cardinality: (a) => (isNull(a) ? null : (Array.isArray(a) ? a.length : 0)),
  array_position: (arr, v) => { if (isNull(arr)) return null; const i = arr.indexOf(v); return i < 0 ? null : i + 1; },
  least: (...a) => a.filter((x) => !isNull(x)).sort((x, y) => x - y)[0] ?? null,
  greatest: (...a) => a.filter((x) => !isNull(x)).sort((x, y) => y - x)[0] ?? null,
  now: () => "NOW",
  jsonb_typeof: (v) => (isNull(v) ? null : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v),
  to_jsonb: (v) => v,
  jsonb_build_object: (...a) => { const o = {}; for (let i = 0; i < a.length; i += 2) o[String(a[i])] = a[i + 1]; return o; },
  gen_random_uuid: () => "uuid-generated",
};

class Interp {
  /**
   * @param {object} env
   *   env.fn      — دوالّ قاعدة البيانات المتاحة {name: (...args) => value}
   *   env.vars    — القيم الابتدائية للمتغيّرات/الوسائط
   *   env.select  — (raw, into, ctx) => {row:[..]|null}   لجُمَل select … into
   *   env.exec    — (raw, verb, ctx) => {rowCount:int}    لـinsert/update/delete
   *   env.query   — (raw, ctx) => any[]                   لـfor … in select … loop
   *   env.trace   — مصفوفة تُسجَّل فيها كلّ الآثار الجانبية
   */
  constructor(env) {
    this.env = env;
    this.vars = Object.assign(Object.create(null), env.vars || {});
    this.trace = env.trace || [];
    this.rowCount = 0;
    this.found = false;
  }
  get(name) {
    const key = String(name);
    if (key in this.vars) return this.vars[key];
    const bare = key.includes(".") ? key.split(".")[0] : null;
    if (bare && bare in this.vars) {
      const o = this.vars[bare];
      if (isNull(o)) return null;                 // سجلّ فارغ ⇒ كلّ حقوله NULL
      const f = key.split(".").slice(1).join(".");
      if (typeof o === "object") return f in o ? o[f] : null;
    }
    if (key.toLowerCase() === "found") return this.found;
    throw new UnsupportedError(`متغيّر غير معرَّف: ${key}`);
  }
  set(name, v) { this.vars[String(name)] = v; }

  ev(e) {
    switch (e.k) {
      case "str": return e.v;
      case "num": return e.v;
      case "lit": return e.v;                     // قيمة مُجمَّعة مسبقًا (aggregate)
      case "star": return 1;
      case "bool": return e.v;
      case "null": return null;
      case "var": return this.get(e.name);
      case "or": return or3(this.ev(e.l), this.ev(e.r));
      case "and": return and3(this.ev(e.l), this.ev(e.r));
      case "not": return not3(this.ev(e.e));
      case "isnull": { const v = this.ev(e.e); return e.neg ? !isNull(v) : isNull(v); }
      case "isbool": { const v = this.ev(e.e); const r = v === e.want; return e.neg ? !r : r; }
      case "distinct": {
        const a = this.ev(e.l), b = this.ev(e.r);
        const d = isNull(a) && isNull(b) ? false : (isNull(a) || isNull(b)) ? true : !eq(a, b);
        return e.neg ? !d : d;
      }
      case "cmp": {
        const a = this.ev(e.l), b = this.ev(e.r);
        if (isNull(a) || isNull(b)) return null;
        switch (e.op) {
          case "=": return eq(a, b);
          case "<>": case "!=": return !eq(a, b);
          case "<": return a < b;
          case ">": return a > b;
          case "<=": return a <= b;
          case ">=": return a >= b;
          default: throw new UnsupportedError(`عامل مقارنة ${e.op}`);
        }
      }
      case "in": {
        const a = this.ev(e.l);
        if (isNull(a)) return null;
        const hit = e.list.some((x) => eq(this.ev(x), a));
        return e.neg ? !hit : hit;
      }
      case "anyof": {
        const a = this.ev(e.l); const arr = this.ev(e.arr);
        if (isNull(a) || isNull(arr)) return null;
        return arr.some((x) => eq(x, a));
      }
      case "like": {
        const a = this.ev(e.l); const p = this.ev(e.r);
        if (isNull(a) || isNull(p)) return null;
        const hit = likeMatch(String(a), String(p));
        return e.neg ? !hit : hit;
      }
      case "haskey": {
        const a = this.ev(e.l); const key = this.ev(e.r);
        if (isNull(a)) return null;
        return Object.prototype.hasOwnProperty.call(a, String(key));
      }
      case "json": {
        const a = this.ev(e.l); const key = this.ev(e.r);
        if (isNull(a)) return null;
        const v = a[String(key)];
        if (isNull(v)) return null;
        return e.op === "->>" ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v;
      }
      case "concat": {
        const a = this.ev(e.l), b = this.ev(e.r);
        if (Array.isArray(a)) return a.concat([b]);
        if (isNull(a) || isNull(b)) return null;
        if (typeof a === "object" && typeof b === "object") return Object.assign({}, a, b);
        return String(a) + String(b);
      }
      case "arith": {
        const a = this.ev(e.l), b = this.ev(e.r);
        if (isNull(a) || isNull(b)) return null;
        return e.op === "+" ? a + b : a - b;
      }
      case "neg": { const v = this.ev(e.e); return isNull(v) ? null : -v; }
      case "cast": {
        const v = this.ev(e.e);
        if (isNull(v)) return null;
        if (e.type === "uuid") { assertUuidish(v); return String(v); }
        if (e.type === "boolean") {
          const s = String(v).toLowerCase();
          if (s === "true" || s === "t" || v === true) return true;
          if (s === "false" || s === "f" || v === false) return false;
          throw new SqlError(`invalid input syntax for type boolean: "${v}"`);
        }
        if (e.type === "int" || e.type === "integer") {
          const n = Number(v);
          if (!Number.isFinite(n)) throw new SqlError(`invalid input syntax for type integer: "${v}"`);
          return n;
        }
        if (e.type === "jsonb" || e.type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        if (e.type === "uuid[]") return Array.isArray(v) ? v : [];
        return v;
      }
      case "arraylit": return e.items.map((x) => this.ev(x));
      case "exists": {
        if (!this.env.exists) throw new UnsupportedError(`exists (${e.query})`);
        return this.env.exists(e.query, this) === true;
      }
      case "case": {
        for (const [c, r] of e.whens) {
          const hit = e.subject === null ? this.ev(c) === true : eq(this.ev(e.subject), this.ev(c));
          if (hit) return this.ev(r);
        }
        return e.els ? this.ev(e.els) : null;
      }
      case "call": {
        const args = e.args.map((a) => this.ev(a));
        const bare = e.name.replace(/^public\./, "");
        if (this.env.fn && bare in this.env.fn) {
          this.trace.push({ call: bare, args });
          return this.env.fn[bare](...args);
        }
        if (bare in BUILTIN) return BUILTIN[bare](...args);
        if (bare === "auth.uid") throw new UnsupportedError("auth.uid غير معرَّفة في البيئة");
        // دالّة غير معرَّفة = دالّة غير موجودة في قاعدة البيانات.
        throw new SqlError(`function ${e.name} does not exist`);
      }
      default: throw new UnsupportedError(`عقدة تعبير ${e.k}`);
    }
  }

  run(stmts) {
    for (const st of stmts) {
      const r = this.exec1(st);
      if (r) return r;
    }
    return null;
  }
  exec1(st) {
    switch (st.s) {
      case "noop": return null;
      case "assign": this.set(st.target, this.ev(st.e)); return null;
      case "return": return { ret: st.e ? this.ev(st.e) : null };
      case "if": {
        for (const [c, body] of st.branches) if (this.ev(c) === true) return this.run(body);
        return st.els ? this.run(st.els) : null;
      }
      case "raise": {
        if (st.level === "exception") {
          const parts = st.parts.map((p) => this.ev(p));
          let msg = String(parts[0] ?? "error");
          for (let i = 1; i < parts.length; i++) msg = msg.replace("%", String(parts[i]));
          this.trace.push({ raise: msg });
          throw new SqlError(msg);
        }
        this.trace.push({ notice: st.parts.map((p) => { try { return this.ev(p); } catch { return "?"; } }) });
        return null;
      }
      case "perform": {
        if (st.tail) {
          if (!this.env.query) throw new UnsupportedError(`perform … ${st.tail}`);
          // النصّ مُعاد بناؤه من الرموز ⇒ «public . t m» بمسافات حول النقطة.
          const am = /^from\s+(?:\w+\s*\.\s*)?\w+\s+(\w+)/i.exec(st.tail);
          const alias = am && !["where", "on", "join", "limit", "order", "group"].includes(am[1].toLowerCase())
            ? am[1] : null;
          const rows = this.env.query(st.tail, this) || [];
          for (const sc of rows) {
            const saved = alias ? this.vars[alias] : undefined;
            if (alias) this.vars[alias] = sc && sc[alias] ? sc[alias] : sc;
            this.trace.push({ perform: this.ev(st.e) });
            if (alias) this.vars[alias] = saved;
          }
          return null;
        }
        this.trace.push({ perform: this.ev(st.e) });
        return null;
      }
      case "block": {
        try { return this.run(st.body); }
        catch (err) {
          if (err instanceof UnsupportedError) throw err;
          if (!st.handler) throw err;
          this.set("sqlerrm", err.sqlerrm || err.message);
          this.vars.sqlerrm = err.sqlerrm || err.message;
          const cond = st.handler.conds[0];
          if (cond !== "others" && cond !== errClass(err)) throw err;
          this.trace.push({ caught: err.sqlerrm || err.message });
          return this.run(st.handler.body);
        }
      }
      case "foreach": {
        const arr = this.ev(st.arr) || [];
        for (const v of arr) {
          this.set(st.v, v);
          const r = this.run(st.body);
          if (r && r.brk) break;
          if (r) return r;
        }
        return null;
      }
      case "forquery": {
        if (!this.env.query) throw new UnsupportedError(`for … in ${st.query}`);
        for (const v of this.env.query(st.query, this)) {
          this.set(st.v, v);
          const r = this.run(st.body);
          if (r && r.brk) break;
          if (r) return r;
        }
        return null;
      }
      case "loop": {
        for (let guard = 0; guard < 1000; guard++) {
          const r = this.run(st.body);
          if (r && r.brk) return null;
          if (r) return r;
        }
        throw new UnsupportedError("حلقة بلا نهاية");
      }
      case "exit": if (st.cond === null || this.ev(st.cond) === true) return { brk: true }; return null;
      case "continue": throw new UnsupportedError("continue");
      case "diagnostics": this.set(st.target, st.what === "row_count" ? this.rowCount : 0); return null;
      case "raw": {
        if (st.verb === "select" && st.into.length > 0) {
          if (!this.env.select) throw new UnsupportedError(`select … into: ${st.raw}`);
          const r = this.env.select(st.raw, st.into, this) || {};
          const row = r.row || null;
          this.found = row !== null;
          st.into.forEach((name, i) => this.set(name, row ? row[i] : null));
          this.rowCount = row ? 1 : 0;
          return null;
        }
        if (!this.env.exec) throw new UnsupportedError(`جملة خام: ${st.raw}`);
        const r = this.env.exec(st.raw, st.verb, this) || {};
        this.rowCount = typeof r.rowCount === "number" ? r.rowCount : 0;
        this.found = this.rowCount > 0;
        return null;
      }
      default: throw new UnsupportedError(`جملة ${st.s}`);
    }
  }
}

function errClass(err) {
  const m = String(err.sqlerrm || err.message || "");
  if (/duplicate key|unique/i.test(m)) return "unique_violation";
  if (/check constraint/i.test(m)) return "check_violation";
  return "others";
}
const eq = (a, b) => (a === b) || (String(a) === String(b) && typeof a !== "object" && typeof b !== "object");
function likeMatch(s, pat) {
  let rx = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "\\") { rx += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") { rx += "[\\s\\S]*"; continue; }
    if (c === "_") { rx += "[\\s\\S]"; continue; }
    rx += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${rx}$`).test(s);
}
function assertUuidish(v) {
  const s = String(v);
  if (!/^[0-9a-fA-F-]{8,}$/.test(s) && !/^[a-z0-9-]+$/.test(s)) {
    throw new SqlError(`invalid input syntax for type uuid: "${s}"`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4) استخراج الدوالّ من ملفّ SQL
// ════════════════════════════════════════════════════════════════════════════

/**
 * يعيد {name, args, lang, body, def} لأحدث تعريف للدالّة في النصّ.
 * `p_after` يسمح باختيار التعريف الواقع بعد موضع معيّن (لأنّ بعض الملفّات
 * تُعيد تعريف الدالّة نفسها داخل execute $fn$ … $fn$).
 */
function extractFunction(sql, name, opts = {}) {
  const re = new RegExp(`create or replace function\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  const hits = [...sql.matchAll(re)];
  if (hits.length === 0) throw new Error(`الدالّة ${name} غير معرَّفة في الملفّ`);
  const idx = opts.index === undefined ? hits.length - 1 : opts.index;
  const at = hits[idx].index;
  // جسم الدالّة = بين أوّل dollar-quote بعد "as" وتوأمها.
  const asAt = sql.indexOf(" as ", at);
  const m = /\$[A-Za-z_]*\$/.exec(sql.slice(asAt));
  if (!m) throw new Error(`تعذّر إيجاد جسم ${name}`);
  const openAt = asAt + m.index;
  const tag = m[0];
  const closeAt = sql.indexOf(tag, openAt + tag.length);
  if (closeAt < 0) throw new Error(`جسم ${name} غير مغلق`);
  const header = sql.slice(at, openAt);
  const body = sql.slice(openAt + tag.length, closeAt);
  const lang = /language\s+plpgsql/i.test(header) ? "plpgsql" : "sql";
  return { name, header, body, lang, def: sql.slice(at, closeAt + tag.length) };
}

/**
 * جسم دالّة `language sql`: إمّا تعبير select واحد (يُقيَّم مباشرةً)، وإمّا
 * استعلامًا بجملة from (يُفوَّض إلى محرّك الجداول: env.selectScalar).
 */
function parseSqlFunction(body) {
  const src = body.replace(/;\s*$/, "").trim();
  const toks = tokenize(src);
  let depth = 0;
  for (const t of toks) {
    if (t.t === "op" && t.v === "(") depth++;
    else if (t.t === "op" && t.v === ")") depth--;
    else if (t.t === "id" && t.v.toLowerCase() === "from" && depth === 0) {
      return (env, vars) => {
        if (!env.selectScalar) throw new UnsupportedError(`select … from داخل دالّة sql: ${src}`);
        return env.selectScalar(src, vars || {});
      };
    }
  }
  const p = new Parser(tokenize(src.replace(/^\s*select\s/i, " ")), src);
  const e = p.parseExpr();
  return (env, vars) => new Interp(Object.assign({}, env, { vars: vars || env.vars })).ev(e);
}

/** جسم دالّة plpgsql: declare … begin … end. */
function parsePlpgsqlFunction(body) {
  const declEnd = /(^|\n)\s*begin\b/i.exec(body);
  if (!declEnd) throw new UnsupportedError("جسم plpgsql بلا begin");
  const decl = body.slice(0, declEnd.index);
  const code = body.slice(declEnd.index + declEnd[0].length);
  const p = new Parser(tokenize(code), code);
  const stmts = p.parseBlock(["end"]);
  const declVars = parseDeclare(decl);
  return { stmts, declVars };
}

/**
 * إعلانات المتغيّرات مع قيمها الابتدائية (v boolean := false).
 * تُعاد **شجرة التعبير** لا قيمته: `v_dry boolean := coalesce(p_dry_run,false)`
 * تعتمد على وسيط النداء ⇒ تقييمها وقت الترجمة كان يجعلها NULL دائمًا.
 */
function parseDeclare(decl) {
  const out = [];
  const clean = decl.replace(/^[\s\S]*?declare/i, "");
  for (const raw of clean.split(";")) {
    const m = /^\s*([a-zA-Z_][\w$]*)\s+([\s\S]+)$/.exec(raw);
    if (!m) continue;
    const name = m[1];
    if (["declare", "begin"].includes(name.toLowerCase())) continue;
    const dm = /:=\s*([\s\S]+)$/.exec(m[2]);
    if (!dm) { out.push([name, null]); continue; }
    const src = dm[1];
    try { out.push([name, new Parser(tokenize(src), src).parseExpr()]); }
    catch { out.push([name, null]); }
  }
  return out;
}

/** يهيّئ متغيّرات declare بالترتيب بعد ربط الوسائط. */
function initDeclared(it, declVars) {
  for (const [name, ast] of declVars) {
    if (name in it.vars) continue;                 // وسيط بنفس الاسم يتقدّم
    it.set(name, ast === null ? null : it.ev(ast));
  }
}

/**
 * يحوّل دالّة (sql أو plpgsql) إلى دالّة JS قابلة للاستدعاء:
 *   const f = compile(SQL, "can_move_deliverable", ["p_project"]);
 *   f(env, { p_project: "P1" })
 */
function compile(sql, name, argNames, opts = {}) {
  const fn = extractFunction(sql, name, opts);
  if (fn.lang === "sql") {
    const run = parseSqlFunction(fn.body);
    return (env, args = {}) => run(env, Object.assign({}, env.vars, args));
  }
  const { stmts, declVars } = parsePlpgsqlFunction(fn.body);
  return (env, args = {}) => {
    const it = new Interp(Object.assign({}, env, { vars: Object.assign({}, env.vars, args) }));
    initDeclared(it, declVars);
    const r = it.run(stmts);
    return r ? r.ret : null;
  };
}

/** نفس compile لكن تُعيد المُفسِّر نفسه (للاطّلاع على الآثار والمتغيّرات). */
function compileVerbose(sql, name, opts = {}) {
  const fn = extractFunction(sql, name, opts);
  if (fn.lang !== "plpgsql") throw new UnsupportedError("compileVerbose لـplpgsql فقط");
  const { stmts, declVars } = parsePlpgsqlFunction(fn.body);
  return (env, args = {}) => {
    const it = new Interp(Object.assign({}, env, { vars: Object.assign({}, env.vars, args) }));
    let ret = null, error = null;
    try { initDeclared(it, declVars); const r = it.run(stmts); ret = r ? r.ret : null; }
    catch (e) { if (e instanceof UnsupportedError) throw e; error = e; }
    return { ret, error, vars: it.vars, trace: it.trace };
  };
}

/** يستخرج شرط أوّل `if` يسبق نصًّا بعينه — لتقييم حارس بعينه بمعزل. */
function guardConditionBefore(body, needle) {
  const at = body.indexOf(needle);
  if (at < 0) throw new Error(`النصّ «${needle}» غير موجود — الحارس محذوف؟`);
  const before = body.slice(0, at);
  const ifAt = before.toLowerCase().lastIndexOf("if ");
  if (ifAt < 0) throw new Error(`لا if قبل «${needle}»`);
  const thenAt = before.toLowerCase().lastIndexOf(" then");
  if (thenAt < ifAt) throw new Error(`لا then بين if و«${needle}»`);
  return before.slice(ifAt + 3, thenAt);
}

/** يقيّم تعبيرًا نصّيًّا من ملفّ SQL في بيئة معطاة. */
function evalCondition(text, env) {
  const p = new Parser(tokenize(text), text);
  const e = p.parseExpr();
  return new Interp(env).ev(e);
}

module.exports = {
  readSql, SqlError, UnsupportedError, isNull, or3, and3, not3,
  tokenize, Parser, Interp, extractFunction, compile, compileVerbose,
  guardConditionBefore, evalCondition, parsePlpgsqlFunction, parseDeclare,
};
