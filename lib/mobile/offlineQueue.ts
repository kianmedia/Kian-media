// ════════════════════════════════════════════════════════════════════════════
// lib/mobile/offlineQueue.ts — **عقد** طابور المزامنة دون اتصال.
//
// Wave 8 · V2-8.6-A
//
// ★★ 🔴 MOBILE OFFLINE MUTATIONS DEFERRED TO WAVE 9 ★★
//   هذا **عقد وأنواع وتحقّق**، ⛔ **وليس محرّكًا**. لا تخزين محلّيّ، ولا مزامنة،
//   ولا إعادة إرسال. الوضع الحاليّ **قراءة فقط عمدًا**، وتغييره **قرار معماريّ
//   لا إصلاح**: الكتابة دون اتصال تعني حسمَ تعارض على بيانات تشغيلية حقيقية،
//   وحسمُ التعارض قرار عمل لا قرار هندسة.
//
// ★ لماذا يُكتب العقد الآن رغم التأجيل ★
//   لأنّ أخطر ما في طابور المزامنة يُقرَّر في أوّل سطر: **ماذا يجوز أن يدخله**.
//   طابور HTTP عامّ يقبل أيّ طلب هو أسوأ تصميم ممكن — يحمل ترويسة اعتماد إلى
//   قرص الجهاز، ويُعيد إرسال عملية مالية بعد أسبوع، ويكتب فوق عمل غيره بصمت.
// ════════════════════════════════════════════════════════════════════════════

export type QueueStatus =
  | "pending" | "syncing" | "succeeded" | "failed"
  | "conflicted" | "expired" | "cancelled";

export const QUEUE_STATUSES: readonly QueueStatus[] = [
  "pending", "syncing", "succeeded", "failed", "conflicted", "expired", "cancelled",
] as const;

/** الحالات التي لا يتحرّك منها العنصر — يُستعمل لمنع إعادة تشغيل نهائيّ. */
export const TERMINAL_STATUSES: readonly QueueStatus[] = [
  "succeeded", "expired", "cancelled",
] as const;

// ─── قائمة السماح للعمليات ──────────────────────────────────────────────────
//
// 🔴 قائمة **مغلقة**: ما ليس هنا لا يدخل الطابور. وكل مدخل يحمل قائمة حقول
//    مسموحة — فلا يُمرَّر جسم طلب حرّ إطلاقًا.
export interface QueueOperationSpec {
  entityType: string;
  operation: string;
  /** الحقول المسموح حملها. ⛔ وما عداها يُرفض لا يُحذف بصمت. */
  allowedFields: readonly string[];
  /** الدالّة الخادمية المقابلة — من سطح `prpc` القائم لا واجهة جديدة. */
  rpc: string;
  maxAgeMs: number;
}

const HOUR = 3_600_000, DAY = 24 * HOUR;

// 🔴 كل `rpc` هنا **دالّة قائمة فعلًا** في `lib/portal/`، واختبار يتحقّق من ذلك
//    مقابل السطح المستخرَج. وقد أُسقطت عمليةُ «ملاحظة مشروع» من هذه القائمة
//    لأنّه **لا توجد دالّة مقابلة لها**، واختراع اسم دالّة يجعل العقد يبدو
//    جاهزًا وهو يشير إلى فراغ.
export const ALLOWED_OPERATIONS: readonly QueueOperationSpec[] = [
  // حضور الموظّف — أوّل ما ينكسر في موقع تصوير بلا شبكة.
  { entityType: "hr_attendance", operation: "check_in",
    allowedFields: ["occurred_at", "lat", "lng", "note"], rpc: "hr_check_in", maxAgeMs: 12 * HOUR },
  { entityType: "hr_attendance", operation: "check_out",
    allowedFields: ["occurred_at", "lat", "lng", "note"], rpc: "hr_check_out", maxAgeMs: 12 * HOUR },

  // تقدّم المهامّ الميدانية.
  { entityType: "hr_task", operation: "start",
    allowedFields: ["task_id", "occurred_at"], rpc: "hr_start_my_task", maxAgeMs: DAY },
  { entityType: "hr_task", operation: "complete",
    allowedFields: ["task_id", "occurred_at", "note"], rpc: "hr_complete_my_task", maxAgeMs: DAY },

  // حالة عهدة — بيانات وصفية، ⛔ لا صور ولا بايتات وسائط.
  { entityType: "custody_condition", operation: "record",
    allowedFields: ["assignment_id", "condition", "note", "occurred_at"],
    rpc: "custody_inv_record_condition", maxAgeMs: 2 * DAY },
] as const;

// ─── 🔴 ما لا يدخل الطابور أبدًا ────────────────────────────────────────────
//
// كل واحد هنا مُدرَج لسبب مختلف — والقائمة تُفحص بالاسم في الاختبارات.
export const FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /password/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /service[_-]?role/i,
  /\bapikey\b|\bapi[_-]key\b/i,
  /authorization/i,
  /\bbearer\b/i,
  /signed[_-]?url/i,
  // ⚠️ بلا `\b`: الشرطة السفلية **محرف كلمة**، فـ`\bsecret\b` لا تطابق
  //    `client_secret` إطلاقًا — وهو أشيع اسم لهذا الحقل تحديدًا.
  /secret/i,
  /\biban\b|\bswift\b|account[_-]?number/i,
  /\bcard[_-]?number\b|\bcvv\b/i,
  /\bcookie\b/i,
] as const;

/** كيانات محظورة كلّيًّا — لا عملية عليها تدخل الطابور. */
export const FORBIDDEN_ENTITY_PATTERNS: readonly RegExp[] = [
  /^fin_/i,          // ماليّ
  /invoice/i, /payment/i, /quote_(accept|approve)/i,
  /approval/i, /decision/i, /change_request/i,   // موافقات إدارية
  /deliverable_final/i,                          // تسليم نهائيّ
  /storage|upload|media_bytes/i,                 // رفع ملفّات خاصّة
] as const;

export interface QueueItem {
  id: string;
  idempotency_key: string;
  actor_id: string;
  entity_type: string;
  entity_id: string | null;
  operation: string;
  payload: Record<string, unknown>;
  created_at: string;
  expires_at: string;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  conflict_reason: string | null;
  status: QueueStatus;
  /** نصّ يُعرض للمستخدم — الحالة وحدها لا تكفي لشرح ما جرى. */
  user_visible_status: string;
}

export type RejectReason =
  | "operation_not_allowed" | "entity_forbidden" | "field_not_allowed"
  | "forbidden_field" | "missing_idempotency_key" | "missing_actor"
  | "payload_not_object" | "payload_too_large";

export type ValidationResult =
  | { ok: true; spec: QueueOperationSpec }
  | { ok: false; reason: RejectReason; detail?: string };

const MAX_PAYLOAD_BYTES = 16 * 1024;

export function findSpec(entityType: string, operation: string): QueueOperationSpec | null {
  return ALLOWED_OPERATIONS.find(
    (o) => o.entityType === entityType && o.operation === operation) ?? null;
}

/**
 * يتحقّق من عنصر قبل قبوله في الطابور.
 *
 * 🔴 يرفض بصراحة ولا **يُنظّف** الحمولة: الحذف الصامت لحقل غير مسموح يجعل
 *    العميل يظنّ أنّ ما أرسله حُفظ كاملًا، وهو أسوأ من الرفض المعلن.
 */
export function validateQueueItem(
  input: { entity_type: string; operation: string; payload: unknown;
           idempotency_key?: string; actor_id?: string },
): ValidationResult {
  if (!input.idempotency_key) return { ok: false, reason: "missing_idempotency_key" };
  if (!input.actor_id) return { ok: false, reason: "missing_actor" };

  for (const re of FORBIDDEN_ENTITY_PATTERNS) {
    if (re.test(input.entity_type)) {
      return { ok: false, reason: "entity_forbidden", detail: input.entity_type };
    }
  }

  const spec = findSpec(input.entity_type, input.operation);
  if (!spec) return { ok: false, reason: "operation_not_allowed",
                      detail: `${input.entity_type}.${input.operation}` };

  if (input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    return { ok: false, reason: "payload_not_object" };
  }
  const payload = input.payload as Record<string, unknown>;

  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }

  for (const key of Object.keys(payload)) {
    // ⛔ الحقل المحظور يُفحص أوّلًا: قد يتسلّل باسم يشبه حقلًا مسموحًا.
    for (const re of FORBIDDEN_FIELD_PATTERNS) {
      if (re.test(key)) return { ok: false, reason: "forbidden_field", detail: key };
    }
    if (!spec.allowedFields.includes(key)) {
      return { ok: false, reason: "field_not_allowed", detail: key };
    }
  }
  // وفحص القيم أيضًا: رمز قد يُمرَّر تحت مفتاح بريء مثل `note`.
  for (const v of Object.values(payload)) {
    if (typeof v !== "string") continue;
    if (/^ey[A-Za-z0-9_-]{10,}\./.test(v)) {
      return { ok: false, reason: "forbidden_field", detail: "jwt_in_value" };
    }
    if (/^https?:\/\/[^\s]*[?&](token|signature|X-Amz-Signature)=/i.test(v)) {
      return { ok: false, reason: "forbidden_field", detail: "signed_url_in_value" };
    }
  }
  return { ok: true, spec };
}

/** انتهاء الصلاحية — لكل عملية عمرها، فحضورٌ عمره أسبوع لا يُسجَّل. */
export function computeExpiry(spec: QueueOperationSpec, createdAtIso: string): string {
  return new Date(new Date(createdAtIso).getTime() + spec.maxAgeMs).toISOString();
}

export function isExpired(item: Pick<QueueItem, "expires_at">, nowIso: string): boolean {
  return new Date(nowIso).getTime() > new Date(item.expires_at).getTime();
}

/**
 * الانتقال المسموح بين الحالات.
 *
 * 🔴 التعارض **لا يُحسم تلقائيًّا**: لا «آخر كتابة تفوز» صامتة، ولا حذف تلقائيّ.
 *    عنصر `conflicted` ينتظر إنسانًا — وإسقاطه بصمت يمحو عمل شخص.
 */
export function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  if ((TERMINAL_STATUSES as readonly string[]).includes(from)) return false;
  const allowed: Record<QueueStatus, readonly QueueStatus[]> = {
    pending:    ["syncing", "cancelled", "expired"],
    syncing:    ["succeeded", "failed", "conflicted", "expired"],
    failed:     ["pending", "cancelled", "expired"],       // إعادة محاولة
    conflicted: ["cancelled"],                              // ⛔ لا حلّ تلقائيّ
    succeeded:  [], expired: [], cancelled: [],
  };
  return allowed[from].includes(to);
}

/** هل يُعاد المحاولة؟ الحدّ يُحترم، والتعارض لا يُعاد إطلاقًا. */
export function shouldRetry(item: Pick<QueueItem, "status" | "retry_count" | "max_retries">): boolean {
  if (item.status === "conflicted") return false;
  if (item.status !== "failed") return false;
  return item.retry_count < item.max_retries;
}

/**
 * إلغاء كل ما ينتظر عند الخروج.
 *
 * 🔴 لأنّ عناصر الطابور تحمل هويّة الفاعل، وإرسالها بعد خروجه — أو بعد دخول
 *    مستخدم آخر على الجهاز — ينسب فعلًا إلى شخص لم يفعله.
 */
export function cancelAllOnLogout(items: readonly QueueItem[]): QueueItem[] {
  return items.map((i) =>
    (TERMINAL_STATUSES as readonly string[]).includes(i.status)
      ? i
      : { ...i, status: "cancelled" as QueueStatus,
          user_visible_status: "أُلغيت لأنّك سجّلت الخروج قبل المزامنة." });
}
