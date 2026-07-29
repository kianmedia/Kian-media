// ════════════════════════════════════════════════════════════════════════════
// tests/fixtures/minidb.js — محرّك SQL صغير في الذاكرة يكفي لتشغيل جُمَل
// select/insert/update الواردة **حرفيًّا** في دوالّ docs/*.sql.
//
// الغرض ليس محاكاة PostgreSQL، بل ألّا تُعاد كتابة أيّ شرط حراسة بالجافاسكربت:
// جملة مثل
//     update public.deliverables set status = r.to_value
//      where id = r.deliverable_id and status = r.from_value
// هي بذاتها ضمان «لا تنفيذ فوق بيانات متغيّرة». لو حُذف `and status = r.from_value`
// من الملفّ، فالمحرّك ينفّذ النصّ الجديد ⇒ الاختبار يسقط. جدول مكتوب باليد كان
// سيبقى أخضر.
//
// كلّ بنية غير مدعومة ترفع UnsupportedError — لا تخطّي صامت.
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const { tokenize, Parser, Interp, UnsupportedError, SqlError, isNull } = require("./plpgsql");

const AGGREGATES = new Set(["count", "max", "min", "sum", "array_agg", "jsonb_agg", "string_agg"]);

/** نطاق صفّ: أسماء الأعمدة (مؤهَّلة وغير مؤهَّلة) ثمّ متغيّرات المُستدعي. */
class RowInterp extends Interp {
  constructor(env, parent, scope) {
    super(env);
    this.parent = parent;
    this.scope = scope; // {alias: row}
    this.trace = parent.trace;
  }
  get(name) {
    const key = String(name);
    if (key.includes(".")) {
      const [a, ...rest] = key.split(".");
      const col = rest.join(".");
      if (a in this.scope) {
        const row = this.scope[a];
        return row && col in row ? row[col] : null;
      }
      return this.parent.get(key);
    }
    for (const a of Object.keys(this.scope)) {
      const row = this.scope[a];
      if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    }
    return this.parent.get(key);
  }
  set(name, v) { this.parent.set(name, v); }
}

// ─── تحليل جملة select ─────────────────────────────────────────────────────
function parseSelect(raw) {
  const p = new Parser(tokenize(raw), raw);
  p.expectId("select");
  const items = [];
  for (;;) {
    if (p.atOp("*")) { p.i++; items.push({ star: true, name: "*" }); }
    else {
      const e = p.parseExpr();
      let name = null;
      if (p.atId("as")) { p.i++; name = p.next().v; }
      else if (p.peek().t === "id" && !["into", "from"].includes(p.peek().v.toLowerCase())) name = p.next().v;
      items.push({ expr: e, name: name || guessName(e) });
    }
    if (p.eatOp(",")) continue;
    break;
  }
  if (p.atId("into")) { p.i++; while (p.peek().t === "id") { p.i++; if (!p.eatOp(",")) break; } }
  const from = [];
  if (p.eatId("from")) {
    from.push(parseSource(p));
    for (;;) {
      const isLeft = p.atId("left");
      if (isLeft) p.i++;
      if (p.atId("inner")) p.i++;
      if (!p.eatId("join")) { if (isLeft) throw new UnsupportedError("left بلا join"); break; }
      const src = parseSource(p);
      p.expectId("on");
      src.on = p.parseExpr();
      src.left = isLeft;
      from.push(src);
    }
  }
  let where = null, limit = null;
  if (p.eatId("where")) where = p.parseExpr();
  if (p.atId("group")) throw new UnsupportedError("group by");
  if (p.atId("order")) { p.i++; p.expectId("by"); p.parseExpr(); if (p.atId("desc") || p.atId("asc")) p.i++; }
  if (p.eatId("limit")) limit = p.next().v;
  if (p.atId("for")) { p.i++; p.i++; } // for update / for share
  return { items, from, where, limit };
}
function parseSource(p) {
  if (p.atId("unnest")) {
    const c = p.parsePrimary();               // unnest(<expr>) ⇒ صفوف من عناصر <expr>
    const e = c.args[0];
    const alias = p.peek().t === "id" ? p.next().v : "u";
    let col = alias;
    if (p.eatOp("(")) { col = p.next().v; p.expectOp(")"); }
    return { unnest: e, alias, col };
  }
  let name = p.next().v;
  while (p.atOp(".")) { p.i++; name = p.next().v; }
  let alias = name;
  const t = p.peek();
  const NOT_ALIAS = ["on", "where", "join", "left", "inner", "limit", "order", "group",
    "for", "into", "as", "set", "values", "returning", "using"];
  if (t.t === "id" && !NOT_ALIAS.includes(t.v.toLowerCase())) alias = p.next().v;
  else if (t.t === "id" && t.v.toLowerCase() === "as") { p.i++; alias = p.next().v; }
  return { table: name, alias };
}
function guessName(e) {
  if (e.k === "var") return e.name.split(".").pop();
  if (e.k === "call") return e.name.split(".").pop();
  return "col";
}

// ─── تنفيذ select على جداول الذاكرة ────────────────────────────────────────
function runSelect(db, q, parent, env) {
  let scopes = [{}];
  for (const src of q.from) {
    const next = [];
    for (const sc of scopes) {
      let rows;
      if (src.unnest) {
        const arr = new RowInterp(env, parent, sc).ev(src.unnest) || [];
        rows = arr.map((v) => ({ [src.col]: v }));
      } else {
        rows = db[src.table] || [];
        if (!db[src.table]) throw new UnsupportedError(`جدول غير معرَّف في التجهيزة: ${src.table}`);
      }
      let matched = 0;
      for (const row of rows) {
        const merged = Object.assign({}, sc, { [src.alias]: row });
        if (src.on && new RowInterp(env, parent, merged).ev(src.on) !== true) continue;
        matched++;
        next.push(merged);
      }
      if (src.left && matched === 0) next.push(Object.assign({}, sc, { [src.alias]: null }));
    }
    scopes = next;
  }
  if (q.where) scopes = scopes.filter((sc) => new RowInterp(env, parent, sc).ev(q.where) === true);
  const rows = q.limit ? scopes.slice(0, q.limit) : scopes;
  return { scopes: rows, all: scopes };
}

function hasAggregate(e) {
  if (!e || typeof e !== "object") return false;
  if (e.k === "call" && AGGREGATES.has(e.name.replace(/^public\./, ""))) return true;
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(hasAggregate) : hasAggregate(v)));
}
function foldAggregates(e, scopes, mk) {
  if (!e || typeof e !== "object") return e;
  if (e.k === "call" && AGGREGATES.has(e.name.replace(/^public\./, ""))) {
    const fname = e.name.replace(/^public\./, "");
    const arg = e.args[0];
    let vals = scopes.map((sc) => (arg && arg.k === "star" ? 1 : mk(sc).ev(arg)));
    if (e.args.distinct) vals = [...new Set(vals)];
    vals = vals.filter((v) => !isNull(v));
    const lit = (v) => ({ k: "lit", v });
    switch (fname) {
      case "count": return lit(scopes.length);
      case "max": return lit(vals.length ? vals.reduce((a, b) => (a > b ? a : b)) : null);
      case "min": return lit(vals.length ? vals.reduce((a, b) => (a < b ? a : b)) : null);
      case "sum": return lit(vals.length ? vals.reduce((a, b) => a + b, 0) : null);
      case "array_agg": case "jsonb_agg": return lit(vals.length ? vals : null);
      default: throw new UnsupportedError(`تجميع ${fname}`);
    }
  }
  const copy = Array.isArray(e) ? [] : {};
  for (const [k, v] of Object.entries(e)) {
    copy[k] = Array.isArray(v) ? v.map((x) => foldAggregates(x, scopes, mk))
      : (v && typeof v === "object" && v.k) ? foldAggregates(v, scopes, mk) : v;
  }
  if (Array.isArray(e)) { const arr = e.map((x) => foldAggregates(x, scopes, mk)); arr.distinct = e.distinct; return arr; }
  return copy;
}

// ─── تحليل جملة update ─────────────────────────────────────────────────────
function parseUpdate(raw) {
  const p = new Parser(tokenize(raw), raw);
  p.expectId("update");
  const src = parseSource(p);
  p.expectId("set");
  const sets = [];
  for (;;) {
    let col = p.next().v;
    if (p.atOp(".")) { p.i++; col = p.next().v; }
    p.expectOp("=");
    sets.push([col, p.parseExpr()]);
    if (p.eatOp(",")) continue;
    break;
  }
  let where = null;
  if (p.eatId("where")) where = p.parseExpr();
  return { src, sets, where };
}

// ─── تحليل جملة insert ─────────────────────────────────────────────────────
function parseInsert(raw) {
  const p = new Parser(tokenize(raw), raw);
  p.expectId("insert"); p.expectId("into");
  let table = p.next().v;
  while (p.atOp(".")) { p.i++; table = p.next().v; }
  const cols = [];
  p.expectOp("(");
  do { cols.push(p.next().v); } while (p.eatOp(","));
  p.expectOp(")");
  p.expectId("values");
  p.expectOp("(");
  const vals = [];
  do { vals.push(p.parseExpr()); } while (p.eatOp(","));
  p.expectOp(")");
  let returning = null;
  if (p.eatId("returning")) {
    returning = p.atOp("*") ? (p.i++, "*") : p.next().v;
    if (p.atId("into")) { p.i++; while (p.peek().t === "id") { p.i++; if (!p.eatOp(",")) break; } }
  }
  return { table, cols, vals, returning };
}

/**
 * قيود التفرّد تُقرأ من نصّ `create unique index … where …` نفسه، فلا تُعاد
 * كتابتها هنا: تغيير الفهرس في الملفّ يغيّر سلوك الاختبار.
 */
function parseUniqueIndexes(sql) {
  const out = [];
  const re = /create unique index (?:if not exists )?(\w+)\s+on public\.(\w+)\s*\(([\s\S]*?)\)\s*(?:where ([^;]+))?;/gi;
  for (const m of sql.matchAll(re)) {
    const [, name, table, colsRaw, whereRaw] = m;
    const cols = splitTop(colsRaw).map((s) => new Parser(tokenize(s), s).parseExpr());
    const where = whereRaw ? new Parser(tokenize(whereRaw), whereRaw).parseExpr() : null;
    out.push({ name, table, cols, where });
  }
  return out;
}
function splitTop(src) {
  const out = []; let depth = 0, cur = "";
  for (const ch of src) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * يبني معالجات البيئة (select/exec/query/exists) فوق جداول الذاكرة.
 * @param {object} db      خريطة {tableName: rows[]}
 * @param {object} options {indexes: [...], now: fn}
 */
function makeEngine(db, options = {}) {
  const indexes = options.indexes || [];
  const engine = {};

  const evalRow = (env, parent, scope, e) => new RowInterp(env, parent, scope).ev(e);

  engine.select = (raw, into, parent) => {
    const q = parseSelect(raw);
    const env = parent.env;
    const { scopes } = runSelect(db, q, parent, env);
    const agg = q.items.some((it) => hasAggregate(it.expr));
    const mk = (sc) => new RowInterp(env, parent, sc);
    if (agg) {
      const folded = q.items.map((it) => foldAggregates(it.expr, scopes, mk));
      return { row: folded.map((e) => mk({}).ev(e)) };
    }
    if (scopes.length === 0) return { row: null };
    const sc = scopes[0];
    if (into.length === 1 && (q.items.length > 1 || q.items[0].star)) {
      const obj = {};
      if (q.items[0].star) {
        for (const t of Object.keys(sc)) Object.assign(obj, sc[t]);
      } else {
        for (const it of q.items) obj[it.name] = evalRow(env, parent, sc, it.expr);
      }
      return { row: [obj] };
    }
    return { row: q.items.map((it) => (it.star ? sc[Object.keys(sc)[0]] : evalRow(env, parent, sc, it.expr))) };
  };

  /** استعلام قياسيّ (دالّة `language sql` بجملة from): أوّل عمود من أوّل صفّ. */
  engine.selectScalar = (raw, vars) => {
    const parent = new Interp({ fn: engine.env.fn, vars: vars || {}, trace: engine.env.trace });
    parent.env = engine.env;
    const q = parseSelect(raw);
    const { scopes } = runSelect(db, q, parent, engine.env);
    const agg = q.items.some((it) => hasAggregate(it.expr));
    const mk = (sc) => new RowInterp(engine.env, parent, sc);
    if (agg) return mk({}).ev(foldAggregates(q.items[0].expr, scopes, mk));
    if (scopes.length === 0) return null;
    const it = q.items[0];
    return it.star ? scopes[0][Object.keys(scopes[0])[0]] : mk(scopes[0]).ev(it.expr);
  };

  engine.exists = (raw, parent) => {
    const q = parseSelect(`select 1 ${raw.replace(/^\s*select\s+1\s*/i, " ")}`);
    const { scopes } = runSelect(db, q, parent, parent.env);
    return scopes.length > 0;
  };

  engine.query = (raw, parent) => {
    const txt = raw.replace(/^\s*/, "");
    if (/^select\s+jsonb_object_keys\s*\(/i.test(txt)) {
      const m = /jsonb_object_keys\s*\(\s*([a-zA-Z_][\w$]*)\s*\)/.exec(txt);
      const v = parent.get(m[1]);
      return Object.keys(v || {});
    }
    if (/^from\s/i.test(txt)) { // ذيل perform … from …
      const q = parseSelect(`select 1 ${txt}`);
      const { scopes } = runSelect(db, q, parent, parent.env);
      return scopes;
    }
    const q = parseSelect(txt);
    const { scopes } = runSelect(db, q, parent, parent.env);
    return scopes.map((sc) => {
      const it = q.items[0];
      return it.star ? sc[Object.keys(sc)[0]] : new RowInterp(parent.env, parent, sc).ev(it.expr);
    });
  };

  engine.exec = (raw, verb, parent) => {
    const env = parent.env;
    if (verb === "update") {
      const q = parseUpdate(raw);
      const rows = db[q.src.table];
      if (!rows) throw new UnsupportedError(`جدول غير معرَّف: ${q.src.table}`);
      let n = 0;
      for (const row of rows) {
        const sc = { [q.src.alias]: row, [q.src.table]: row };
        if (q.where && new RowInterp(env, parent, sc).ev(q.where) !== true) continue;
        const patch = {};
        for (const [col, e] of q.sets) patch[col] = new RowInterp(env, parent, sc).ev(e);
        Object.assign(row, patch);
        n++;
      }
      return { rowCount: n };
    }
    if (verb === "insert") {
      const q = parseInsert(raw);
      const rows = db[q.table];
      if (!rows) throw new UnsupportedError(`جدول غير معرَّف: ${q.table}`);
      const row = {};
      q.cols.forEach((c, i) => { row[c] = new RowInterp(env, parent, {}).ev(q.vals[i]); });
      applyDefaults(q.table, row, options);
      for (const ix of indexes.filter((x) => x.table === q.table)) {
        const key = (r) => ix.cols.map((c) => String(new RowInterp(env, parent, { [q.table]: r }).ev(c))).join(" ");
        const live = (r) => !ix.where || new RowInterp(env, parent, { [q.table]: r }).ev(ix.where) === true;
        if (live(row) && rows.some((r) => live(r) && key(r) === key(row))) {
          throw new SqlError(`duplicate key value violates unique constraint "${ix.name}"`);
        }
      }
      rows.push(row);
      if (q.returning) parent.set(lastIntoTarget(raw), q.returning === "*" ? row : row[q.returning]);
      return { rowCount: 1, row };
    }
    throw new UnsupportedError(`جملة ${verb}: ${raw}`);
  };

  return engine;
}

function lastIntoTarget(raw) {
  const m = /returning\s+\S+\s+into\s+([a-zA-Z_][\w$]*)/i.exec(raw);
  if (!m) throw new UnsupportedError(`returning بلا into: ${raw}`);
  return m[1];
}

/** القيم الافتراضية التي يملؤها الخادم (تُبقي الصفّ صالحًا للفحوص اللاحقة). */
function applyDefaults(table, row, options) {
  const now = options.now ? options.now() : "NOW";
  if (table === "project_transition_requests") {
    if (isNull(row.id)) row.id = `req-${(options.seq ? options.seq() : Math.random().toString(36).slice(2))}`;
    if (isNull(row.status)) row.status = "pending";
    if (isNull(row.requested_at)) row.requested_at = now;
    if (isNull(row.expires_at)) row.expires_at = options.expiresAt ? options.expiresAt() : "FUTURE";
    if (isNull(row.execution_result)) row.execution_result = {};
    for (const c of ["decided_by", "decided_at", "decision_note", "executed_at"]) if (!(c in row)) row[c] = null;
  }
  if (table === "activity_log" && isNull(row.id)) row.id = `log-${Math.random().toString(36).slice(2)}`;
}

module.exports = { makeEngine, parseSelect, parseUpdate, parseInsert, parseUniqueIndexes, RowInterp };
