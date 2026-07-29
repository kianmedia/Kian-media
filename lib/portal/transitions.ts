// ════════════════════════════════════════════════════════════════════════════
// lib/portal/transitions.ts — «طلبات الانتقال»: مسار الطلب والموافقة للإجراءات
// التي لا يجوز لغير المخوَّل تنفيذها مباشرةً على المخرجات أو على مرحلة المشروع.
//
// ─── لماذا هذا الملف موجود ───
// من ينفّذ العمل (مونتير/مصوّر…) كان يستطيع فعليًّا — على الخادم لا في الواجهة
// فقط — نقل مخرج بين المراحل، وتغيير حالته إلى «معتمد/سُلِّم نهائيًّا»، وإظهاره
// للعميل. هذه الثلاثة قرارات إدارية لا خطوات تنفيذ. البديل الأمين ليس إخفاء
// الأزرار — إخفاء الزرّ ليس حدًّا أمنيًّا — بل **استبدال المسار**: الطلب يُسجَّل،
// والتنفيذ لا يقع إلا بموافقة صريحة من صاحب الصلاحية.
//
// ─── الحدّ الحقيقيّ هو الخادم ───
// كلّ ما في هذا الملف واجهة. البوّابة الحقيقية هي حزمة SQL (SECURITY DEFINER +
// RLS). لا يجوز أن يعتمد أيّ قرار أمنيّ على القيم المحسوبة هنا، ووظيفة هذه
// الطبقة أن تجعل المسار الأمين ظاهرًا والمسار الممنوع **غائبًا**.
//
// ─── العقد المطلوب من حزمة SQL (بالاسم والتوقيع) ───
// جدول:  public.project_transition_requests
// دوال:
//   project_transition_request_create(
//       p_project uuid, p_deliverable uuid, p_kind text, p_from_value text,
//       p_to_value text, p_reason text, p_dry_run boolean default false)
//     → jsonb {ok, request_id, status, duplicate, message}
//     · p_dry_run=true ⇒ **بلا أيّ أثر** (يُستعمل للكشف عن وجود الدالّة فقط).
//     · تمنع طلبًا ثانيًا مطابقًا ما دام الأوّل «pending» (فهرس فريد جزئيّ) وتعيد
//       duplicate=true بدل إنشاء صفّ ثانٍ.
//     · تُنشئ إشعارًا داخل البوّابة لأصحاب القرار. **لا إشعار للعميل إطلاقًا.**
//   project_transition_requests_list(p_project uuid, p_status text, p_limit int)
//     → jsonb[]  (مُثراة: اسم الطالب/المخرج/المشروع + from_label/to_label)
//   project_transition_request_decide(
//       p_request uuid, p_decision text, p_note text,
//       p_dry_run boolean default false)
//     → jsonb {ok, request_id, status, applied, message}
//     · الموافقة هي وحدها ما ينفّذ التغيير، وتُشعر الطالب بالقرار والملاحظة.
//   project_transition_can_decide(p_project uuid) → boolean  (NOT NULL أبدًا)
//
// ⚠️ `p_dry_run` جزء من العقد لا زينة: بدونه لا سبيل لفحص وجود الدالّة بلا كتابة،
// فيُقرأ غيابها PGRST202 وتُعطَّل الشاشة. هذا هو الاتجاه الآمن (تعطيل لا ادّعاء).
//
// ─── الكشف عن القدرات ───
// الكود يُنشر قبل الـSQL. لذلك كلّ شيء هنا اختياريّ ويُفحص وقت التشغيل، والواجهة
// تهبط إلى حالة «معطَّل» عربية صريحة بدل الانهيار. والتصنيف مُفوَّض بالكامل إلى
// lib/portal/pgerror.ts: **رفض الصلاحية (42501/403) لا يُعرض أبدًا كترحيلة ناقصة.**
// ════════════════════════════════════════════════════════════════════════════

import { pget, prpc, currentUserId, type Result } from "@/lib/portal/client";
import { pgClassify, pgLog, pgUserMessageAr, pgIsMigrationPending, type PgDiagnosis } from "@/lib/portal/pgerror";
import { LP_STATUS_LABELS } from "@/lib/portal/large-projects";
import type { Caps as RoleCaps } from "@/lib/portal/roles";

// ─────────────────────────────────────────────────────────────────────────────
// 1) المفردات
// ─────────────────────────────────────────────────────────────────────────────

/** نوع الانتقال المطلوب. لا اختراع لمفردات قاعدة بيانات: القيم نفسها تُرسَل كنصّ. */
export type TrKind = "project_stage" | "stage" | "status" | "client_visibility";

export const TR_KINDS: TrKind[] = ["project_stage", "stage", "status", "client_visibility"];

export const TR_KIND_LABELS: Record<TrKind, { ar: string; en: string }> = {
  project_stage:     { ar: "نقل مرحلة المشروع", en: "Move project stage" },
  stage:             { ar: "نقل المخرج بين المراحل", en: "Move deliverable between stages" },
  status:            { ar: "تغيير حالة المخرج", en: "Change deliverable status" },
  client_visibility: { ar: "إظهار المخرج للعميل", en: "Reveal deliverable to the client" },
};

/** حالة الطلب. `pending` وحدها تمنع طلبًا مطابقًا جديدًا. */
export type TrStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export const TR_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  pending:   { ar: "بانتظار الموافقة", en: "Awaiting approval" },
  approved:  { ar: "معتمد ونُفِّذ", en: "Approved & applied" },
  rejected:  { ar: "مرفوض", en: "Rejected" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
  // الطلب المعلَّق ينتهي بعد مدّة على الخادم؛ بلا وسم عربيّ هنا كان يظهر بالمفتاح الخام.
  expired:   { ar: "منتهي الصلاحية", en: "Expired" },
};

export const TR_STATUS_TONE: Record<string, "info" | "ok" | "error" | "warn"> = {
  pending: "warn", approved: "ok", rejected: "error", cancelled: "info", expired: "info",
};

export type TrDecision = "approve" | "reject";

export const TR_TABLE = "project_transition_requests";

export const TR_RPC = {
  create: "project_transition_request_create",
  list: "project_transition_requests_list",
  decide: "project_transition_request_decide",
  canDecide: "project_transition_can_decide",
} as const;

export type TrRpcKey = keyof typeof TR_RPC;

/**
 * الاسم الأوّل في كلّ سطر هو **العقد**؛ ما بعده اسم بديل يُقبل فقط حين يكون
 * الأوّل غائبًا فعلًا. السبب عمليّ لا تجميليّ: حزمة الـSQL تُكتب في مسار منفصل
 * عن هذه الطبقة، وخلاف اسم واحد كان سيُظهر الشاشة «ترحيلة ناقصة» إلى الأبد رغم
 * تطبيق الحزمة. وهذا **لا يوسّع صلاحية أحد**: كلّ اسم هنا دالّة على الخادم
 * محكومة بمسنَداتها، والواجهة لا تملك إلا استدعاءها.
 */
export const TR_RPC_CANDIDATES: Record<TrRpcKey, string[]> = {
  create: [TR_RPC.create, "project_transition_request"],
  list: [TR_RPC.list, "project_transition_request_list"],
  decide: [TR_RPC.decide, "project_transition_decide"],
  canDecide: [TR_RPC.canDecide, "can_approve_project_transition"],
};

/** أقصى عدد أهداف في طلب جماعيّ واحد — يمنع إغراق صندوق القرار بمئات الطلبات. */
export const TR_MAX_BATCH = 25;

/** صفّ الطلب كما تعيده دالّة القائمة. كل حقل مُثرًى اختياريّ (`| null`). */
export interface TrRequest {
  id: string;
  project_id: string;
  project_name: string | null;
  deliverable_id: string | null;
  deliverable_title: string | null;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  /** وسم جاهز من الخادم؛ تسقط الواجهة إلى trFallbackLabel عند غيابه. */
  from_label: string | null;
  to_label: string | null;
  reason: string;
  status: string;
  requested_by: string | null;
  requester_name: string | null;
  requested_at: string | null;
  decided_by: string | null;
  decider_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface TrCreateOutcome {
  ok: boolean;
  request_id: string | null;
  status: string;
  /** true = طلب مطابق معلَّق موجود أصلًا؛ لم يُنشأ صفّ ثانٍ. */
  duplicate: boolean;
  message: string | null;
}

export interface TrDecideOutcome {
  ok: boolean;
  request_id: string | null;
  status: string;
  /** true = التغيير نُفِّذ فعلًا على المخرج/المشروع. */
  applied: boolean;
  message: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) بوّابات العرض — قيم منطقية صريحة، لا `undefined` ولا `null` أبدًا
//
// سبب التشديد: مُسنَد منطقيّ يعود NULL تسبّب سابقًا حادثة fail-open حقيقية في
// هذا المستودع. كلّ دالّة هنا تعيد boolean حرفيًّا في كلّ مسار.
// ─────────────────────────────────────────────────────────────────────────────

/** من يجوز أن **يطلب**: كوادر كيان، عدا العميل و«مشاهدة فقط». */
export function trCanRequest(role: RoleCaps | null | undefined): boolean {
  if (!role) return false;
  if (role.isClientSide === true) return false;
  if (role.isStaff !== true) return false;
  if (role.isReadonly === true) return false;
  return true;
}

/**
 * من يجوز أن **يقرّر**: المالك/المدير فقط (isAdminArea = owner/super_admin/manager).
 * المونتير والعميل مستثنيان صراحةً — تكرارٌ مقصود: لو اتّسع isAdminArea يومًا،
 * يبقى زرّ الموافقة غائبًا عنهما. والقرار الحقيقيّ للخادم على أيّ حال.
 */
export function trCanDecide(role: RoleCaps | null | undefined): boolean {
  if (!role) return false;
  if (role.isClientSide === true) return false;
  if (role.isEditor === true) return false;
  return role.isAdminArea === true;
}

/** من يجب أن يمرّ عبر الطلب بدل التنفيذ المباشر. */
export function trMustRequest(role: RoleCaps | null | undefined): boolean {
  return trCanRequest(role) === true && trCanDecide(role) === false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) الكشف عن القدرات
// ─────────────────────────────────────────────────────────────────────────────

export interface TrCapabilities {
  /** الجدول موجود (أو موجود ومحميّ) — false يعني غيابه فعلًا. */
  table: boolean;
  createRpc: boolean;
  listRpc: boolean;
  decideRpc: boolean;
  canDecideRpc: boolean;
  /** الاسم المُثبَت لكلّ دالّة (من العقد أو من بديله)، أو null حين لا وجود لها. */
  fn: Record<TrRpcKey, string | null>;
  /** كلّ ما يلزم لتسجيل طلب. */
  request: boolean;
  /** كلّ ما يلزم لعرض الطلبات والبتّ فيها. */
  decide: boolean;
  /** أسماء الكائنات الغائبة فعلًا — لرسالة صريحة لا تخمين. */
  missing: string[];
  /**
   * سبب التعطيل حين لا يكون ترحيلة ناقصة. «permission» لا تُعرض أبدًا كترحيلة —
   * هذا بالضبط الخلط الذي كلّف دورة تصحيح إنتاجية كاملة.
   */
  noteKind: "none" | "migration" | "permission" | "auth" | "network" | "unknown";
  checkedAt: number;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const TR_TTL_MS = 5 * 60 * 1000;
let trCache: TrCapabilities | null = null;
let trInflight: Promise<TrCapabilities> | null = null;

export function trResetCapabilities(): void { trCache = null; trInflight = null; }

/** الكائن غائب فعلًا؟ 42501/403 ليس غيابًا، والشبكة ليست غيابًا. */
function absent(d: PgDiagnosis): boolean { return pgIsMigrationPending(d) === true; }

function noteOf(d: PgDiagnosis): TrCapabilities["noteKind"] {
  if (pgIsMigrationPending(d)) return "migration";
  switch (d.verdict) {
    case "permission": return "permission";
    case "auth": return "auth";
    case "network": return "network";
    case "no_rows": return "none";
    default: return "unknown";
  }
}

async function probeTable(): Promise<{ present: boolean; note: TrCapabilities["noteKind"] }> {
  const r = await pget<unknown[]>(`${TR_TABLE}?select=id&id=eq.${ZERO_UUID}&limit=1`);
  if (r.ok) return { present: true, note: "none" };
  const d = pgLog({ component: "transitions", table: TR_TABLE, purpose: "probe transition requests table" }, r.error, r.status);
  return { present: !absent(d), note: noteOf(d) };
}

async function probeRpc(fn: string, args: Record<string, unknown>): Promise<{ present: boolean; note: TrCapabilities["noteKind"] }> {
  const r = await prpc<unknown>(fn, args);
  if (r.ok) return { present: true, note: "none" };
  const d = pgLog({ component: "transitions", rpc: fn, purpose: "probe transition rpc (no-op)" }, r.error, r.status);
  return { present: !absent(d), note: noteOf(d) };
}

/** أوّل اسم موجود من المرشَّحين، أو null. الترتيب مقصود: العقد أوّلًا. */
async function resolveRpc(
  key: TrRpcKey, args: Record<string, unknown>,
): Promise<{ name: string | null; note: TrCapabilities["noteKind"] }> {
  let note: TrCapabilities["noteKind"] = "none";
  for (const fn of TR_RPC_CANDIDATES[key]) {
    const r = await probeRpc(fn, args);
    if (r.present === true) return { name: fn, note: r.note };
    if (note === "none") note = r.note;
  }
  return { name: null, note };
}

async function detect(): Promise<TrCapabilities> {
  const [tbl, create, list, decide, canDecide] = await Promise.all([
    probeTable(),
    // p_dry_run=true ⇒ بلا أثر. عدم تطابق التوقيع يعود PGRST202 ⇒ «غائبة» ⇒ تعطيل.
    resolveRpc("create", {
      p_project: ZERO_UUID, p_deliverable: null, p_kind: "status",
      p_from_value: null, p_to_value: null, p_reason: "probe", p_dry_run: true,
    }),
    resolveRpc("list", { p_project: ZERO_UUID, p_status: "pending", p_limit: 1 }),
    resolveRpc("decide", { p_request: ZERO_UUID, p_decision: "reject", p_note: "probe", p_dry_run: true }),
    resolveRpc("canDecide", { p_project: ZERO_UUID }),
  ]);

  // canDecide مسنَد استرشاديّ للعرض وحده: القرار الحقيقيّ يقع داخل دالّة البتّ
  // على الخادم. لذلك غيابه **لا** يُعطّل الشاشة ولا يُحسب ترحيلةً ناقصة.
  const missing: string[] = [];
  if (!tbl.present) missing.push(TR_TABLE);
  if (!create.name) missing.push(TR_RPC.create);
  if (!list.name) missing.push(TR_RPC.list);
  if (!decide.name) missing.push(TR_RPC.decide);

  const notes = [tbl.note, create.note, list.note, decide.note];
  const noteKind: TrCapabilities["noteKind"] =
    missing.length > 0 ? "migration"
    : notes.includes("auth") ? "auth"
    : notes.includes("network") ? "network"
    : notes.includes("permission") ? "permission"
    : notes.includes("unknown") ? "unknown"
    : "none";

  return {
    table: tbl.present === true,
    createRpc: create.name !== null,
    listRpc: list.name !== null,
    decideRpc: decide.name !== null,
    canDecideRpc: canDecide.name !== null,
    fn: { create: create.name, list: list.name, decide: decide.name, canDecide: canDecide.name },
    request: tbl.present === true && create.name !== null,
    decide: tbl.present === true && list.name !== null && decide.name !== null,
    missing,
    noteKind,
    checkedAt: Date.now(),
  };
}

/** قدرات مخزَّنة خمس دقائق ومحميّة من الطلبات المتوازية. */
export function trCapabilities(force = false): Promise<TrCapabilities> {
  if (!force && trCache && Date.now() - trCache.checkedAt < TR_TTL_MS) return Promise.resolve(trCache);
  if (!force && trInflight) return trInflight;
  if (force) trResetCapabilities();
  trInflight = detect()
    .then((c) => { trCache = c; trInflight = null; return c; })
    .catch((e) => { trInflight = null; throw e; });
  return trInflight;
}

/**
 * الرسالة العربية الصريحة لحالة التعطيل — أو null حين لا شيء يمنع.
 * لا تقول «الترحيلة غير مطبّقة» إلا حين يكون كائن غائبًا فعلًا.
 */
export function trUnavailableAr(caps: TrCapabilities | null, need: "request" | "decide"): string | null {
  if (!caps) return "جارٍ التحقّق من توفّر مسار طلبات الانتقال…";
  const ready = need === "request" ? caps.request : caps.decide;
  if (ready === true) return null;
  switch (caps.noteKind) {
    case "migration":
      return `مسار «طلبات الانتقال» غير مفعَّل بعد: حزمة قاعدة البيانات لم تُطبَّق (${caps.missing.join("، ")}). لا يمكن تسجيل الطلبات ولا اعتمادها حتى تُطبَّق.`;
    case "permission":
      return "لا تملك صلاحية الوصول إلى طلبات الانتقال. هذا رفض صلاحية من قاعدة البيانات لا نقص في الترحيل.";
    case "auth":
      return "انتهت الجلسة — سجّل الدخول من جديد ثم أعد المحاولة.";
    case "network":
      return "تعذّر الاتصال بقاعدة البيانات للتحقّق من مسار طلبات الانتقال. تحقّق من الشبكة وأعد المحاولة.";
    default:
      return "تعذّر التحقّق من مسار «طلبات الانتقال». أعد المحاولة، وإن تكرّر فأبلغ الفريق التقنيّ.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) الوصول
// ─────────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const bool = (v: unknown): boolean => v === true || v === "true";

function toRow(raw: unknown): TrRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    project_id: String(o.project_id ?? ""),
    project_name: str(o.project_name),
    deliverable_id: str(o.deliverable_id),
    deliverable_title: str(o.deliverable_title),
    kind: String(o.kind ?? ""),
    from_value: str(o.from_value),
    to_value: str(o.to_value),
    from_label: str(o.from_label),
    to_label: str(o.to_label),
    reason: String(o.reason ?? ""),
    status: String(o.status ?? "pending"),
    requested_by: str(o.requested_by),
    requester_name: str(o.requester_name),
    requested_at: str(o.requested_at) ?? str(o.created_at),
    decided_by: str(o.decided_by),
    decider_name: str(o.decider_name),
    decided_at: str(o.decided_at),
    decision_note: str(o.decision_note),
  };
}

/**
 * الاسم الحيّ للدالّة، أو خطأ صريح حين لا وجود لها. لا استدعاء «على أمل»:
 * غياب الحزمة يُقال، ولا يُترجم إلى فشل غامض.
 */
async function liveFn(key: TrRpcKey): Promise<{ ok: true; fn: string } | { ok: false; error: string; status: number }> {
  const c = await trCapabilities();
  const fn = c.fn[key];
  if (!fn) return { ok: false, error: "transitions_unavailable", status: 501 };
  return { ok: true, fn };
}

/** صفوف الطلبات. الدالّة قد تعيد مصفوفة jsonb أو setof — كلاهما مقبول. */
export async function trList(
  projectId: string, status: "pending" | "all" = "pending", limit = 100,
): Promise<Result<TrRequest[]>> {
  const f = await liveFn("list");
  if (!f.ok) return { ok: false, error: f.error, status: f.status };
  const r = await prpc<unknown>(f.fn, { p_project: projectId, p_status: status, p_limit: limit });
  if (!r.ok) {
    pgLog({ component: "transitions", rpc: f.fn, purpose: "list transition requests" }, r.error, r.status);
    return r;
  }
  const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
  const rows = arr.map(toRow).filter((x): x is TrRequest => x !== null);
  return { ok: true, data: rows };
}

export interface TrCreateInput {
  projectId: string;
  deliverableId: string | null;
  kind: TrKind;
  fromValue: string | null;
  toValue: string | null;
  reason: string;
}

/** تسجيل طلب. لا ينفّذ شيئًا — التنفيذ عند الموافقة فقط. */
export async function trCreate(input: TrCreateInput): Promise<Result<TrCreateOutcome>> {
  const reason = input.reason.trim();
  if (reason === "") return { ok: false, error: "reason_required", status: 400 };
  const f = await liveFn("create");
  if (!f.ok) return { ok: false, error: f.error, status: f.status };
  const r = await prpc<unknown>(f.fn, {
    p_project: input.projectId,
    p_deliverable: input.deliverableId,
    p_kind: input.kind,
    p_from_value: input.fromValue,
    p_to_value: input.toValue,
    p_reason: reason,
    p_dry_run: false,
  });
  if (!r.ok) {
    pgLog({ component: "transitions", rpc: f.fn, purpose: "create transition request" }, r.error, r.status);
    return r;
  }
  const o = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      // غياب `ok` من الردّ لا يُقرأ نجاحًا: HTTP 200 وحده لا يثبت أن الطلب سُجِّل.
      ok: bool(o.ok),
      request_id: str(o.request_id),
      status: String(o.status ?? "pending"),
      duplicate: bool(o.duplicate),
      message: str(o.message),
    },
  };
}

/** نتيجة هدف واحد داخل طلب جماعيّ — تُعرض كما هي، بلا تجميع يبتلع الفشل. */
export interface TrBatchResult {
  key: string;
  label: string;
  /** null حين فشل النداء نفسه (والسبب في error). */
  outcome: TrCreateOutcome | null;
  error: string | null;
}

export interface TrBatchInput extends TrCreateInput { key: string; label: string }

/**
 * تسجيل طلب لكلّ هدف على حدة، **بالتسلسل** لا بالتوازي: الفهرس الفريد الجزئيّ في
 * قاعدة البيانات يرفض المكرَّر، والتوازي كان سيحوّل ذلك إلى سباق يصعب تفسيره
 * للمستخدم. لا شيء يُنفَّذ هنا — الطلبات فقط.
 */
export async function trCreateMany(inputs: TrBatchInput[]): Promise<Result<TrBatchResult[]>> {
  if (inputs.length === 0) return { ok: false, error: "no_targets", status: 400 };
  if (inputs.length > TR_MAX_BATCH) return { ok: false, error: "too_many_targets", status: 400 };
  const out: TrBatchResult[] = [];
  for (const it of inputs) {
    const r = await trCreate(it);
    out.push(r.ok
      ? { key: it.key, label: it.label, outcome: r.data, error: null }
      : { key: it.key, label: it.label, outcome: null, error: trErr(r.error, r.status) });
  }
  return { ok: true, data: out };
}

/** البتّ في طلب. الموافقة وحدها هي ما ينفّذ التغيير — على الخادم. */
export async function trDecide(
  requestId: string, decision: TrDecision, note: string,
): Promise<Result<TrDecideOutcome>> {
  const f = await liveFn("decide");
  if (!f.ok) return { ok: false, error: f.error, status: f.status };
  const r = await prpc<unknown>(f.fn, {
    p_request: requestId, p_decision: decision, p_note: note.trim() || null, p_dry_run: false,
  });
  if (!r.ok) {
    pgLog({ component: "transitions", rpc: f.fn, purpose: "decide transition request" }, r.error, r.status);
    return r;
  }
  const o = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      ok: bool(o.ok),
      request_id: str(o.request_id) ?? requestId,
      status: String(o.status ?? (decision === "approve" ? "approved" : "rejected")),
      applied: bool(o.applied),
      message: str(o.message),
    },
  };
}

/**
 * هل يوجد طلب معلَّق مطابق؟ حارس واجهة يمنع الإرسال المكرَّر قبل الرحلة للخادم؛
 * الحارس القاطع فهرسٌ فريد جزئيّ في قاعدة البيانات على
 * (project_id, deliverable_id, kind, to_value) — لذلك «المطابق» هنا يشمل القيمة
 * المطلوبة أيضًا: طلب نقلٍ إلى المرحلة (أ) لا يمنع طلب نقلٍ إلى المرحلة (ب).
 * تمرير toValue = undefined يعني «أيّ طلب معلَّق من هذا النوع» (للشارة لا للمنع).
 */
export function trHasPending(
  rows: TrRequest[], deliverableId: string | null, kind: TrKind, toValue?: string | null,
): boolean {
  for (const r of rows) {
    if (r.status !== "pending") continue;
    if (r.kind !== kind) continue;
    if ((r.deliverable_id ?? null) !== (deliverableId ?? null)) continue;
    if (toValue !== undefined && (r.to_value ?? null) !== (toValue ?? null)) continue;
    return true;
  }
  return false;
}

/** طلباتي المعلَّقة في هذا المشروع — لتعطيل الأزرار المكرَّرة وعرض «بانتظار الموافقة». */
export async function trMyPending(projectId: string): Promise<Result<TrRequest[]>> {
  const r = await trList(projectId, "pending", 200);
  if (!r.ok) return r;
  const uid = currentUserId();
  return { ok: true, data: uid ? r.data.filter((x) => x.requested_by === uid) : r.data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) عرض
// ─────────────────────────────────────────────────────────────────────────────

/**
 * وسم عربيّ لقيمة انتقال حين لا يرسل الخادم from_label/to_label.
 * لا يُخترع اسم مرحلة: معرّف المرحلة يبقى كما هو (مختصرًا) لأن اسمها ليس هنا.
 */
export function trFallbackLabel(kind: string, value: string | null | undefined): string {
  const v = value == null ? "" : String(value).trim();
  if (v === "") return "—";
  if (kind === "status") return LP_STATUS_LABELS[v]?.ar ?? v;
  if (kind === "client_visibility") return v === "true" || v === "1" ? "ظاهر للعميل" : "مخفيّ عن العميل";
  if (kind === "stage") return v.length > 12 ? `${v.slice(0, 8)}…` : v;
  return v;
}

export const trKindLabel = (kind: string): string =>
  (TR_KIND_LABELS as Record<string, { ar: string }>)[kind]?.ar ?? kind;

export const trStatusLabel = (status: string): string =>
  TR_STATUS_LABELS[status]?.ar ?? status;

export function trWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
}

/** رسالة خطأ عربية صادقة — نفس مُصنِّف بقية البوّابة، بلا تعبيرات نمطية محلّية. */
export function trErr(error: string, status?: number): string {
  if (error === "reason_required") return "السبب إلزاميّ — اكتب سبب الطلب قبل الإرسال.";
  if (error === "no_targets") return "لا عنصر محدَّد — اختر ما تريد طلب انتقاله أوّلًا.";
  if (error === "too_many_targets") return `الحدّ الأقصى ${TR_MAX_BATCH} عنصرًا في الطلب الواحد — ضيّق التحديد.`;
  // غياب الحزمة يُقال باسمه: ترحيلة لم تُطبَّق، لا «رفض صلاحية» ولا عطل غامض.
  if (error === "transitions_unavailable") {
    return "مسار «طلبات الانتقال» غير مفعَّل بعد: حزمة قاعدة البيانات لم تُطبَّق. لا يمكن تسجيل الطلبات ولا اعتمادها حتى تُطبَّق.";
  }
  return pgUserMessageAr(pgClassify(error, status));
}
