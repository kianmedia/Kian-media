// ════════════════════════════════════════════════════════════════════════════
// lib/portal/pgerror.ts — ONE honest classifier for PostgREST/PostgreSQL errors.
//
// WHY THIS FILE EXISTS (a real production cost, do not undo it)
// ─────────────────────────────────────────────────────────────
// A dashboard request asked `projects?select=…,due_date`. public.projects has
// no due_date column (the deadline lives on public.project_core.due_date), so
// PostgREST answered HTTP 400 / SQLSTATE 42703. The old classifier folded 42703
// together with PGRST204 into a single "missing_column" bucket whose Arabic text
// was «الترحيلة غير مطبّقة: عمود مطلوب غير موجود بعد» — "the migration has not
// been applied". The migration was fine. THE QUERY WAS WRONG. The owner spent a
// production debugging cycle hunting an unapplied migration that did not exist.
//
// The rule this file enforces: an error message may only assert a cause the
// evidence actually supports. Nine distinct outcomes, never collapsed:
//
//   PGRST202 / 42883   the FUNCTION is absent            → migration-pending
//   PGRST204 / PGRST205 PostgREST's schema cache is stale → "reload schema"
//   42703              a COLUMN named in OUR request does not exist
//                      ⇒ suspect the request first; NEVER assert "migration
//                        not applied" — that is what cost the cycle
//   42P01              the RELATION is absent            → migration-pending
//   42501 / 403        permission / RLS denial           → NEVER a column story
//   42601 / PGRST100   the query itself is malformed     → our bug
//   401                the session is gone
//   status 0           the network never reached Postgres
//   zero rows          NOT AN ERROR AT ALL. RLS filtering a reader down to zero
//                      rows is frequently the correct, intended answer.
//   anything else      honestly labelled "unknown" — never guessed
//
// TWO AUDIENCES, TWO OUTPUTS
//   • developer → pgLog(): component, table-or-RPC, code, missing column, and
//     the purpose of the request. Redacted (see pgRedact) and never the URL,
//     which carries row ids and filter values.
//   • user → pgUserMessageAr(): matches the ACTUAL cause, and always carries a
//     short technical tail so the underlying code is never swallowed.
//
// The shared REST client (lib/portal/client.ts) flattens PostgREST's JSON body
// down to its `message` string, so on the browser path the SQLSTATE is usually
// ABSENT from the text. The server path (lib/portal/import/server.ts) keeps a
// "CODE | message" prefix. Both are handled: codes are matched when present and
// inferred from the message shape when they are not.
// ════════════════════════════════════════════════════════════════════════════

export type PgErrorKind =
  /** PGRST202 / 42883 — the function is not in the database. */
  | "missing_function"
  /** PGRST204 / PGRST205 — the object exists but PostgREST's cache is stale. */
  | "schema_cache_stale"
  /** 42703 — a column named in OUR request does not exist. */
  | "missing_column"
  /** 42P01 — the table/view does not exist. */
  | "missing_table"
  /** 42501 / HTTP 403 / RLS write denial. */
  | "permission_denied"
  /** 42601 / PGRST100 — malformed SQL or malformed PostgREST filter. */
  | "invalid_query"
  /** HTTP 401 — no session, expired or revoked. */
  | "not_authenticated"
  /** Transport never completed; Postgres was never reached. */
  | "network"
  /** Zero rows. NOT an error: RLS may be answering correctly. */
  | "empty_result"
  /** Unrecognised. Labelled honestly instead of guessed. */
  | "unknown";

/**
 * What the error is blamed on. This is the field that makes the old confusion
 * impossible: only "schema_missing" may ever be rendered as «الترحيل معلّق».
 */
export type PgVerdict =
  /** The database object is genuinely absent — a migration really is pending. */
  | "schema_missing"
  /** The object exists; PostgREST must reload its schema cache. */
  | "cache_stale"
  /** OUR request is at fault (wrong column name, malformed filter). */
  | "our_request"
  /** Authorisation, not schema. */
  | "permission"
  | "auth"
  | "network"
  /** Not a failure at all. */
  | "no_rows"
  | "unknown";

export interface PgDiagnosis {
  kind: PgErrorKind;
  verdict: PgVerdict;
  /** Best-known code: a real one when present, an inferred one when the shared
   *  client has already stripped it. null when nothing supports a guess. */
  code: string | null;
  /** false only for "empty_result". */
  isError: boolean;
  /** Column named by the error, e.g. "projects.due_date". */
  column: string | null;
  /** Relation named by the error. */
  relation: string | null;
  /** Function named by the error. */
  fn: string | null;
  /** HTTP status when known. */
  status: number | null;
  /** The raw message, unmodified — the developer must always see the truth. */
  message: string;
}

// ─── redaction ──────────────────────────────────────────────────────────────

/**
 * Strip anything that must never reach a log: bearer tokens, JWTs, API keys,
 * passwords, e-mail addresses, phone-length digit runs, row ids and whole URLs
 * (a PostgREST URL carries filter values, i.e. real data). Structure survives,
 * so the message stays diagnosable.
 */
export function pgRedact(input: string): string {
  return String(input ?? "")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, "<jwt>")
    .replace(/\b(apikey|api_key|access_token|refresh_token|authorization|bearer|password|passwd|secret|token|key)\b\s*[:=]\s*[^\s,;&)"']+/gi, "$1=<redacted>")
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b\d{9,}\b/g, "<number>");
}

/**
 * Reduce a PostgREST path to the safe part: the table or RPC name. Everything
 * after "?" is filters — row ids, keys, names — and is dropped, never logged.
 */
export function pgSafeTarget(pathOrTable: string): string {
  const head = String(pathOrTable ?? "").split("?")[0].replace(/^\/?(rest\/v1\/)?/, "").replace(/\/+$/, "");
  return head || "(unknown)";
}

// ─── classification ─────────────────────────────────────────────────────────

const firstMatch = (re: RegExp, s: string): string | null => {
  const m = re.exec(s);
  if (!m) return null;
  for (let i = 1; i < m.length; i++) if (m[i]) return m[i];
  return null;
};

/** "column projects.due_date does not exist" / PGRST204's quoted form. */
function columnOf(e: string): string | null {
  return (
    firstMatch(/column\s+"([^"]+)"\s+of\s+relation/i, e) ??
    firstMatch(/column\s+(?:"([^"]+)"|([A-Za-z0-9_.]+))\s+does not exist/i, e) ??
    firstMatch(/could not find the '([^']+)' column/i, e) ??
    firstMatch(/could not find the "([^"]+)" column/i, e)
  );
}

function relationOf(e: string): string | null {
  return (
    firstMatch(/relation\s+"?([A-Za-z0-9_.]+)"?\s+does not exist/i, e) ??
    firstMatch(/could not find the table\s+'([^']+)'/i, e) ??
    firstMatch(/could not find the table\s+"([^"]+)"/i, e) ??
    firstMatch(/column\s+"[^"]+"\s+of\s+relation\s+"([^"]+)"/i, e) ??
    firstMatch(/permission denied for (?:table|relation|view)\s+([A-Za-z0-9_.]+)/i, e)
  );
}

function functionOf(e: string): string | null {
  return (
    firstMatch(/could not find the function\s+([A-Za-z0-9_.]+)/i, e) ??
    firstMatch(/function\s+([A-Za-z0-9_.]+)\s*\(/i, e) ??
    firstMatch(/permission denied for function\s+([A-Za-z0-9_.]+)/i, e)
  );
}

const has = (re: RegExp, s: string): boolean => re.test(s);

/**
 * Classify one failed request. Pure and total: it never throws and never
 * invents a cause. Order is deliberate — authorisation is decided BEFORE any
 * schema question, so a permission denial can never surface as "missing column"
 * (an explicitly required guarantee), and the function case is decided before
 * the schema-cache case because PGRST202's own text says "in the schema cache".
 */
export function pgClassify(error: string | null | undefined, status?: number): PgDiagnosis {
  const message = String(error ?? "");
  const e = message.toLowerCase();
  const st = typeof status === "number" ? status : null;

  const build = (kind: PgErrorKind, verdict: PgVerdict, code: string | null): PgDiagnosis => ({
    kind, verdict, code, isError: kind !== "empty_result",
    column: columnOf(message), relation: relationOf(message), fn: functionOf(message),
    status: st, message,
  });

  if (st === 0 || has(/failed to fetch|networkerror|load failed|econnrefused|etimedout/, e)) {
    return build("network", "network", null);
  }
  if (st === 401 || has(/\bnot_authenticated\b|session_expired|\bjwt\b|invalid (?:token|claim)/, e)) {
    return build("not_authenticated", "auth", st === 401 ? "401" : null);
  }
  // Authorisation FIRST. A 42501 must never be told as a schema story.
  if (st === 403 || has(/\b42501\b|permission denied|insufficient_privilege|row-level security|violates row-level security|not authorized|not_authorized|admin only/, e)) {
    return build("permission_denied", "permission", has(/\b42501\b/, e) ? "42501" : st === 403 ? "403" : "42501");
  }
  if (has(/\bpgrst202\b|\b42883\b|could not find the function|function not found|no function matches/, e)) {
    return build("missing_function", "schema_missing", has(/\b42883\b/, e) ? "42883" : "PGRST202");
  }
  // PGRST204/205 = the object is missing FROM THE CACHE, not necessarily from
  // the database. The fix is "reload schema", not "run a migration".
  if (has(/\bpgrst204\b/, e)) return build("schema_cache_stale", "cache_stale", "PGRST204");
  if (has(/\bpgrst205\b/, e)) return build("schema_cache_stale", "cache_stale", "PGRST205");
  if (has(/schema cache/, e)) {
    return build("schema_cache_stale", "cache_stale", has(/column/, e) ? "PGRST204" : "PGRST205");
  }
  // 42703 — OUR request named a column that does not exist. Suspect the request.
  if (has(/\b42703\b/, e) || has(/column\s+.*does not exist/, e)) {
    return build("missing_column", "our_request", "42703");
  }
  if (has(/\b42p01\b/, e) || has(/relation\s+.*does not exist/, e)) {
    return build("missing_table", "schema_missing", "42P01");
  }
  if (has(/\b42601\b|syntax error/, e)) return build("invalid_query", "our_request", "42601");
  if (has(/\bpgrst100\b|failed to parse|unexpected .*expecting|parse error/, e)) {
    return build("invalid_query", "our_request", "PGRST100");
  }
  return build("unknown", "unknown", null);
}

/**
 * Zero rows came back. This is a RESULT, not a failure: an RLS policy that
 * filters a reader down to nothing is usually answering correctly. Callers must
 * render "no data" — never an error, never «الترحيل معلّق».
 */
export function pgEmptyResult(note = "zero rows (RLS or filters) — not an error"): PgDiagnosis {
  return { kind: "empty_result", verdict: "no_rows", code: null, isError: false, column: null, relation: null, fn: null, status: 200, message: note };
}

/**
 * Classify a Result-shaped outcome. Returns null for a successful request that
 * carried rows — there is nothing to diagnose. A successful request with ZERO
 * rows returns an "empty_result" diagnosis whose isError is false, so callers
 * can render "no data" without ever mistaking RLS for a broken deployment.
 */
export function pgClassifyResult(
  r: { ok: boolean; error?: string | null; status?: number },
  rowCount?: number,
): PgDiagnosis | null {
  if (!r.ok) return pgClassify(r.error, r.status);
  return typeof rowCount === "number" && rowCount === 0 ? pgEmptyResult() : null;
}

/**
 * TRUE only when a database object is genuinely absent, i.e. the only case in
 * which a UI may say «الترحيل معلّق». 42703 is deliberately excluded: it far
 * more often means our own SELECT is wrong.
 */
export function pgIsMigrationPending(d: PgDiagnosis | PgErrorKind): boolean {
  const kind = typeof d === "string" ? d : d.kind;
  return kind === "missing_function" || kind === "missing_table";
}

/** TRUE when the fault is in the request we sent, not in the database. */
export function pgIsOurFault(d: PgDiagnosis): boolean {
  return d.verdict === "our_request";
}

// ─── developer-facing output ────────────────────────────────────────────────

export interface PgContext {
  /** Where the request was issued from, e.g. "LargeProjectDashboard". */
  component: string;
  /** Table name — NOT the URL, which carries row ids and filter values. */
  table?: string;
  /** RPC name, when the call was a function. */
  rpc?: string;
  /** Why the request was made, in plain words. */
  purpose: string;
}

/** The single sentence a developer needs. Redacted; safe to print anywhere. */
export function pgDevLine(d: PgDiagnosis, ctx: PgContext): string {
  const target = ctx.rpc ? `rpc:${pgSafeTarget(ctx.rpc)}` : ctx.table ? `table:${pgSafeTarget(ctx.table)}` : "target:(unknown)";
  const bits = [
    `[pg] ${ctx.component}`,
    target,
    `purpose="${ctx.purpose}"`,
    `code=${d.code ?? "-"}`,
    `kind=${d.kind}`,
    `verdict=${d.verdict}`,
  ];
  if (d.column) bits.push(`column=${d.column}`);
  if (d.relation) bits.push(`relation=${d.relation}`);
  if (d.fn) bits.push(`function=${d.fn}`);
  if (d.status !== null) bits.push(`http=${d.status}`);
  bits.push(`message="${pgRedact(d.message)}"`);
  if (d.kind === "missing_column") {
    bits.push('note="42703 = the column named in OUR request does not exist. Check the select list BEFORE suspecting a migration."');
  }
  if (d.kind === "schema_cache_stale") bits.push('note="reload PostgREST schema cache"');
  return bits.join(" ");
}

/** Last diagnoses, newest last — for an in-app diagnostics panel. Redacted. */
const RING_MAX = 25;
const ring: { at: number; line: string; kind: PgErrorKind; code: string | null }[] = [];
export function pgRecentDiagnostics(): { at: number; line: string; kind: PgErrorKind; code: string | null }[] {
  return ring.slice();
}

/**
 * Classify, record and print one failure. Returns the diagnosis so the caller
 * can branch on it. Never logs a token, a session, an API key, personal data or
 * a URL — only the table/RPC, the code and the stated purpose.
 */
export function pgLog(ctx: PgContext, error: string | null | undefined, status?: number): PgDiagnosis {
  const d = pgClassify(error, status);
  const line = pgDevLine(d, ctx);
  ring.push({ at: Date.now(), line, kind: d.kind, code: d.code });
  if (ring.length > RING_MAX) ring.shift();
  try {
    // Redacted by construction, so it is safe in production too — the point of
    // this file is that the real code is never swallowed.
    if (d.verdict === "our_request") console.error(line);
    else console.warn(line);
  } catch { /* a console-less runtime must never break a request */ }
  return d;
}

// ─── user-facing Arabic ─────────────────────────────────────────────────────

/** Short technical tail so the underlying error is never hidden from anyone. */
export function pgTechnicalTail(d: PgDiagnosis): string {
  const parts: string[] = [];
  if (d.code) parts.push(d.code);
  if (d.column) parts.push(`العمود: ${d.column}`);
  else if (d.fn && d.kind === "missing_function") parts.push(`الدالّة: ${d.fn}`);
  else if (d.relation && d.kind === "missing_table") parts.push(`الجدول: ${d.relation}`);
  return parts.length ? ` (${parts.join(" — ")})` : "";
}

/**
 * The user-facing Arabic sentence for a diagnosis — each cause worded as what
 * it actually is. In particular «عمود مطلوب غير موجود» is used ONLY where a
 * column really is absent, and it does not blame the migration, because a 42703
 * is far more often our own SELECT asking for a column that never existed.
 */
export function pgUserMessageAr(d: PgDiagnosis): string {
  const tail = pgTechnicalTail(d);
  switch (d.kind) {
    case "missing_function":
      return `الترحيلة غير مطبّقة: الدالّة المطلوبة غير موجودة في قاعدة البيانات.${tail}`;
    case "missing_table":
      return `الترحيلة غير مطبّقة: جدول مطلوب غير موجود في قاعدة البيانات.${tail}`;
    case "schema_cache_stale":
      return `الخادم يقرأ نسخة قديمة من مخطط قاعدة البيانات. أعِد تحميل المخطط (Reload schema) ثم أعد المحاولة.${tail}`;
    case "missing_column":
      return `طلبت الشاشة عمودًا غير موجود في هذا الجدول${d.column ? ` («${d.column}»)` : ""}. هذا خطأ في الاستعلام نفسه غالبًا وليس ترحيلة ناقصة — أبلغ الفريق التقنيّ باسم العمود.${tail}`;
    case "permission_denied":
      return `لا تملك صلاحية هذا الإجراء.${tail}`;
    case "invalid_query":
      return `طلب غير صالح (خطأ برمجيّ في الواجهة، لا نقص في قاعدة البيانات). أبلغ الفريق التقنيّ.${tail}`;
    case "not_authenticated":
      return "انتهت الجلسة — سجّل الدخول من جديد.";
    case "network":
      return "تعذّر الاتصال. تحقّق من الشبكة وأعد المحاولة.";
    case "empty_result":
      return "لا توجد بيانات لعرضها ضمن صلاحيتك.";
    default:
      return `تعذّر تنفيذ الطلب. حاول مرة أخرى.${tail}`;
  }
}

/** Classify and phrase in one step. */
export function pgMessageAr(error: string | null | undefined, status?: number): string {
  return pgUserMessageAr(pgClassify(error, status));
}
