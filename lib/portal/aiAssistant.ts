// ════════════════════════════════════════════════════════════════════════════
// lib/portal/aiAssistant.ts — browser client for KIAN AI ASSISTANT (Phase C).
//
// Anon key only, exactly like every other portal module. **All** authority
// lives in the database: ai_can_use_internal() / ai_can_view_knowledge() /
// ai_source_permitted_for() are re-checked inside every RPC, so hiding a button
// here is a courtesy, never a control.
//
// FEATURE DETECTION. Code ships BEFORE SQL. Every call maps "the function is
// not deployed" to a DISTINCT, honest state so the UI can say «الميزة بانتظار
// تفعيل قاعدة البيانات» instead of blanking, showing a misleading zero, or
// blaming the user's permissions. Reporting a permission error as a missing
// migration already cost this project a production debugging cycle (see the
// header of lib/portal/pgerror.ts).
//
// ⛔ FIVE THINGS THIS FILE NEVER DOES
//   1. It never calls a model provider. There is no fetch to any external host
//      anywhere in this module — not disabled, not commented, ABSENT. The only
//      provider surface is the database's ai_provider_describe(), which reports
//      «not_configured».
//   2. It never renders retrieved text as instructions or as markup. Every
//      excerpt passes through aiSanitizeForDisplay() and is rendered as PLAIN
//      TEXT by the components (no dangerouslySetInnerHTML anywhere in this
//      module). Retrieved content is DATA.
//   3. It never invents an answer. When the server says
//      refusal_code = 'no_approved_source' the UI shows the server's own
//      sentence «لا توجد لدي معلومة معتمدة كافية للإجابة» — it does not soften
//      it, does not summarise, and does not fall back to a generic reply.
//   4. It never claims the assistant works. providerIsAnswering() exists so no
//      screen can imply generation while `generated_text` is null.
//   5. It never carries the public surface. ai_public_ask / ai_public_lead_draft
//      are NOT reachable from the browser at all: they are granted to
//      service_role only and are called from app/api/public/assistant.
//
// ★ THE CLIENT-SIDE GUARD IS ADVISORY AND FAIL-CLOSED-ONLY ★
//   aiPreflightGuard() mirrors the CATEGORY NAMES of public.ai_guard_question().
//   It may only ADD a refusal before a round-trip; it can never permit anything
//   the database would refuse, because the database refuses independently. A
//   test pins the category names in both directions so the two cannot drift
//   into a false sense of coverage.
// ════════════════════════════════════════════════════════════════════════════

import { prpc, type Result } from "@/lib/portal/client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

// ─── Vocabulary — mirrors the CHECK constraints one to one ──────────────────

export type AiSourceType =
  | "public_website" | "service_catalog" | "faq" | "company_policy"
  | "operations_procedure" | "sales_guide" | "pricing_guidance"
  | "compliance_guide" | "equipment_procedure" | "hr_policy"
  | "approved_case_study" | "approved_template" | "other";

export const AI_SOURCE_TYPE_AR: Record<AiSourceType, string> = {
  public_website: "محتوى الموقع العامّ",
  service_catalog: "كتالوج الخدمات",
  faq: "أسئلة شائعة",
  company_policy: "سياسة شركة",
  operations_procedure: "إجراء تشغيليّ",
  sales_guide: "دليل مبيعات",
  pricing_guidance: "إرشاد تسعير",
  compliance_guide: "دليل امتثال",
  equipment_procedure: "إجراء معدّات",
  hr_policy: "سياسة موارد بشرية",
  approved_case_study: "دراسة حالة معتمَدة",
  approved_template: "نموذج معتمَد",
  other: "أخرى",
};

export type AiSourceStatus = "draft" | "in_review" | "approved" | "rejected" | "expired" | "archived";
export const AI_SOURCE_STATUS_AR: Record<AiSourceStatus, string> = {
  draft: "مسودّة",
  in_review: "قيد المراجعة",
  approved: "معتمَد",
  rejected: "مرفوض",
  expired: "منتهٍ",
  archived: "مؤرشَف",
};

export type AiSensitivity = "public" | "internal" | "restricted";
export const AI_SENSITIVITY_AR: Record<AiSensitivity, string> = {
  public: "عامّ",
  internal: "داخليّ",
  restricted: "مقيَّد",
};

export type AiAssistantRole =
  | "owner" | "sales" | "operations" | "collections" | "marketing" | "client" | "anonymous";

export const AI_ROLE_AR: Record<AiAssistantRole, string> = {
  owner: "المالك",
  sales: "المبيعات",
  operations: "التشغيل",
  collections: "التحصيل",
  marketing: "التسويق",
  client: "عميل",
  anonymous: "زائر",
};

export type AiConfidence = "none" | "low" | "medium" | "high";
export const AI_CONFIDENCE_AR: Record<AiConfidence, string> = {
  none: "لا ثقة — لا مصدر",
  low: "ثقة منخفضة",
  medium: "ثقة متوسّطة",
  high: "ثقة عالية",
};

/** Every provider status the DB may report. `mock` is the only non-error one,
 *  and it still means NOTHING WAS GENERATED. */
export type AiProviderStatus =
  | "not_configured" | "disabled" | "mock" | "error" | "timeout" | "invalid_response";

export const AI_PROVIDER_STATUS_AR: Record<AiProviderStatus, string> = {
  not_configured: "مزوّد النموذج غير مضبوط",
  disabled: "مزوّد النموذج معطَّل",
  mock: "مزوّد وهميّ (لا توليد)",
  error: "خطأ من المزوّد",
  timeout: "انتهت مهلة المزوّد",
  invalid_response: "ردّ المزوّد غير صالح",
};

export type AiLeadStatus = "pending_human_review" | "accepted" | "rejected" | "spam";
export const AI_LEAD_STATUS_AR: Record<AiLeadStatus, string> = {
  pending_human_review: "بانتظار مراجعة بشرية",
  accepted: "مقبول",
  rejected: "مرفوض",
  spam: "مزعج",
};

/** The exact sentence the database returns when nothing approved matched.
 *  Duplicated here ONLY so a test can prove the UI never replaces it. */
export const AI_NO_SOURCE_AR = "لا توجد لدي معلومة معتمدة كافية للإجابة";

/** The exact sentence the mock provider returns. It must never be softened. */
export const AI_PROVIDER_NOTICE_AR = "مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط";

/** Refusal codes, each phrased as what it ACTUALLY is. */
export const AI_REFUSAL_AR: Record<string, string> = {
  blocked_by_guard:
    "طلب مرفوض: المحتوى لدى المساعد بيانات لا تعليمات، ولا يُخرج أسرارًا ولا بيانات حسّاسة ولا ينفّذ أوامر.",
  no_approved_source: AI_NO_SOURCE_AR,
  question_too_short: "اكتب سؤالًا أوضح من فضلك.",
  public_assistant_disabled: "المساعد العامّ غير مفعّل حاليًّا.",
  rate_limited: "عدد المحاولات تجاوز الحدّ. حاول بعد قليل.",
};

/** Guard categories — the SAME names the database uses. A test pins parity. */
export type AiGuardCategory =
  | "prompt_injection" | "sensitive_personal_finance" | "bulk_exfiltration"
  | "secret_request" | "sql_execution" | "tool_invocation";

export const AI_GUARD_CATEGORY_AR: Record<AiGuardCategory, string> = {
  prompt_injection: "محاولة توجيه المساعد بتعليمات مدسوسة",
  sensitive_personal_finance: "طلب بيانات مالية أو هوية شخصية حسّاسة",
  bulk_exfiltration: "طلب تصدير جماعيّ للبيانات",
  secret_request: "طلب سرّ أو مفتاح أو كلمة مرور",
  sql_execution: "طلب توليد أو تنفيذ استعلام",
  tool_invocation: "طلب تنفيذ أداة أو إرسال رسالة",
};

// ─── Row / payload shapes ───────────────────────────────────────────────────

export interface AiKnowledgeSource {
  id: string;
  source_type: AiSourceType;
  title_ar: string;
  title_en: string;
  language: "ar" | "en" | "both";
  status: AiSourceStatus;
  sensitivity: AiSensitivity;
  allowed_roles: AiAssistantRole[];
  content_kind: "inline" | "storage" | "url";
  content_text: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  source_url: string | null;
  version: number;
  checksum: string | null;
  effective_from: string | null;
  expires_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

/** A permission-filtered citation. `source_version` and `freshness_days` are
 *  part of the contract: an answer without them is not auditable. */
export interface AiCitation {
  source_id: string;
  title_ar?: string;
  source_title?: string;
  title_en?: string | null;
  source_type: AiSourceType;
  source_version: number;
  effective_from?: string | null;
  expires_at?: string | null;
  approved_at?: string | null;
  freshness_days: number | null;
  rank?: number | null;
}

export interface AiEvidence {
  source_id: string;
  chunk_index?: number | null;
  excerpt: string;
  title_ar: string;
  source_type: AiSourceType;
  sensitivity?: AiSensitivity;
  source_version: number;
  freshness_days?: number | null;
}

export interface AiProviderDescription {
  contract_version: number;
  provider: string;
  enabled: boolean;
  status: "not_configured" | "disabled_by_design";
  timeout_ms: number;
  credentials_in_repo: false;
  browser_calls_allowed: false;
  autonomous_actions: false;
  tool_execution: false;
  notice: string;
  cost_metadata: { currency: string; input_tokens: number | null; output_tokens: number | null; estimated_cost: number | null };
}

export interface AiAnswer {
  ok: boolean;
  conversation_id?: string;
  message_id?: string;
  refusal_code?: string | null;
  answer: string;
  /** ALWAYS null in V1. Its presence in the type is the honesty contract: a
   *  screen that wants "the generated answer" finds nothing to show. */
  generated_text: null;
  retrieved_count: number;
  confidence?: AiConfidence;
  citations: AiCitation[];
  evidence: AiEvidence[];
  is_data_not_instructions: boolean;
  tool_execution: false;
  tools: never[];
  guard?: AiGuardVerdict;
  provider?: Record<string, unknown>;
  roles?: AiAssistantRole[];
}

export interface AiGuardVerdict {
  blocked: boolean;
  categories: AiGuardCategory[];
  injection?: { flagged: boolean; patterns: string[] };
  checked_at?: string;
}

export interface AiAssistantStatePayload {
  migration: "applied";
  assistant_enabled: boolean;
  can_use_internal: boolean;
  roles: AiAssistantRole[];
  is_staff: boolean;
  can_view_knowledge: boolean;
  can_manage_knowledge: boolean;
  can_approve_knowledge: boolean;
  can_review_leads: boolean;
  can_redact: boolean;
  can_manage_settings: boolean;
  sources_total: number;
  sources_approved: number;
  knowledge_state: "not_permitted" | "empty_registry" | "ready";
  provider: AiProviderDescription;
  autonomous_actions: false;
  tool_execution: false;
  read_only: true;
}

export interface AiConversationRow {
  id: string;
  actor_user_id: string | null;
  actor_kind: "internal" | "public";
  actor_roles: AiAssistantRole[];
  channel: "internal" | "public";
  title: string | null;
  retention_class: "minimal" | "standard" | "extended";
  redaction_status: "none" | "partial" | "redacted" | "purged";
  escalation_status: "none" | "requested" | "assigned" | "resolved";
  escalation_note: string | null;
  message_count: number;
  created_at: string;
  last_message_at: string | null;
  expires_at: string | null;
  purged_at: string | null;
}

export interface AiMessageRow {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system_notice";
  content: string;
  refusal_code: string | null;
  retrieved_count: number;
  confidence: AiConfidence | null;
  provider_status: AiProviderStatus;
  redaction_status: string;
  created_at: string;
  citations: AiCitation[];
}

export interface AiLeadDraft {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  service_interest: string | null;
  message: string;
  locale: "ar" | "en";
  status: AiLeadStatus;
  handoff_status: "awaiting_human" | "in_progress" | "closed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  captcha_status: "not_configured" | "not_required" | "verified" | "failed";
  source: string;
  privacy_notice_version: string;
  created_at: string;
}

// ─── Feature-detected outcome ───────────────────────────────────────────────

export type AiState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "offline"; message: string }
  | { state: "error"; message: string };

export const AI_PENDING_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/kian_ai_assistant_RUNME.sql. لا يوجد خطأ في صلاحياتك.";

export const AI_DENIED_AR = "لا تملك صلاحية هذا الإجراء في مساعد كيان.";

function toState<T>(r: Result<unknown>, pick: (d: unknown) => T): AiState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    // ★ Four causes stay four causes. Collapsing any pair is the exact mistake
    //   documented at the top of lib/portal/pgerror.ts.
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: AI_PENDING_AR };
    if (d.kind === "permission_denied") return { state: "denied", message: AI_DENIED_AR };
    if (d.kind === "network") {
      return { state: "offline", message: "تعذّر الاتصال بالخادم. لم يصل الطلب إلى قاعدة البيانات." };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  return { state: "ok", data: pick(r.data) };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// ─── ★ Display safety — retrieved text is DATA, and is rendered as text ★ ────

/**
 * Make one retrieved excerpt safe to put on a screen. The database already
 * neutralises source text (public.ai_neutralize) — this is the SECOND layer,
 * on the rendering side, because "the server sanitised it" is an assumption a
 * UI must not make about text it did not produce.
 *
 * It removes, in order:
 *   • angle-bracket markup      → no tag can ever reach the DOM as markup
 *   • zero-width / bidi overrides → no hidden instruction, no visual spoofing
 *   • markdown links whose target is a SIGNED or tokenised URL → a citation
 *     must never become a clickable route to a private object
 *   • bare signed/tokenised URLs
 *   • data: and javascript: URLs
 *
 * It deliberately does NOT try to detect "instructions" — that is the guard's
 * job, on the way IN. This function's only promise is: whatever this returns is
 * inert text.
 */
export function aiSanitizeForDisplay(input: string | null | undefined): string {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.replace(/<[^>]{0,4000}>/g, " ");
  // Zero-width + bidi-override + BOM, written as escapes on purpose: a literal
  // invisible character inside a regex is unreviewable and unmaintainable.
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  // Markdown link whose href looks signed/tokenised — drop the href, keep the label.
  s = s.replace(
    /\[([^\]]{0,200})\]\(\s*[^)\s]*(?:token=|X-Amz-|\/object\/sign\/|signature=|access_token=)[^)\s]*\s*\)/gi,
    "$1 (رابط-موقَّع-محذوف)",
  );
  s = s.replace(/https?:\/\/\S*(?:token=|X-Amz-|\/object\/sign\/|signature=|access_token=)\S*/gi, "[رابط-موقَّع-محذوف]");
  s = s.replace(/\[([^\]]{0,200})\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "$1");
  s = s.replace(/\b(?:javascript|vbscript|data):[^\s)]+/gi, "[رابط-محذوف]");
  return s;
}

/**
 * True only when a real model actually produced text. In V1 this is ALWAYS
 * false, and every screen asks it instead of assuming.
 *
 * ⚠️ The parameter is deliberately typed `unknown`, not `AiAnswer`. AiAnswer
 * pins generated_text to `null`, so TypeScript would narrow the check to
 * `never` and the function would stop being a runtime guard at exactly the
 * moment it matters — the day a provider is wired up and starts returning a
 * string that the type still claims is impossible.
 */
export function providerIsAnswering(a: { generated_text?: unknown } | null | undefined): boolean {
  const t = a?.generated_text;
  return typeof t === "string" && t.length > 0;
}

/** The honest one-line status for a provider description. Never "ready". */
export function providerLabelAr(p: AiProviderDescription | null | undefined): string {
  if (!p) return "حالة المزوّد غير معروفة";
  if (!p.enabled) return `${AI_PROVIDER_NOTICE_AR} (المزوّد: ${p.provider} — غير مفعّل)`;
  return `${AI_PROVIDER_NOTICE_AR} (المزوّد مذكور لكنّه لا يولّد نصًّا في هذه النسخة)`;
}

// ─── ★ Advisory pre-flight guard (mirrors ai_guard_question categories) ★ ────

const GUARD_PATTERNS: { category: AiGuardCategory; re: RegExp }[] = [
  // prompt_injection — instruction override, prompt disclosure, role markers,
  // impersonation, guard bypass. Same five families as ai_detect_injection.
  // ★ The qualifier (previous/prior/…) is OPTIONAL. "ignore all instructions"
  //   without the word "the" is the single most common injection opener and it
  //   used to slip past this pattern entirely. Mirrors the same fix in SQL.
  { category: "prompt_injection", re: /(ignore|disregard|forget)\s+(all\s+|any\s+)?((previous|prior|earlier|above|the)\s+)?(instructions|rules|prompt|policy|what i said)/i },
  { category: "prompt_injection", re: /تجاهل\s+(كل|كلّ|جميع)?\s*(التعليمات|الأوامر|القواعد|ما\s+سبق)/ },
  { category: "prompt_injection", re: /(system\s*prompt|reveal\s+(your|the)\s+(prompt|instructions)|what\s+are\s+your\s+instructions|repeat\s+(the\s+)?(system|initial)\s+(prompt|message))/i },
  { category: "prompt_injection", re: /(اكشف|أظهر|اطبع)\s*(لي)?\s*(تعليمات|توجيهات)\s*(النظام|نظامك)/ },
  { category: "prompt_injection", re: /(<\/?(system|assistant|tool|instructions)>|\[\[?system\]?\]|###\s*system|begin\s+system)/i },
  { category: "prompt_injection", re: /(you\s+are\s+now|act\s+as\s+(the\s+)?(owner|admin|root|system)|pretend\s+(to\s+be|you)|developer\s+mode|jailbreak|dan\s+mode)/i },
  { category: "prompt_injection", re: /(تصرّف|تصرف)\s+(ك|بصفتك)\s*(المالك|المدير|النظام)/ },
  { category: "prompt_injection", re: /(bypass|override|disable|turn\s+off)\s+(the\s+)?(permission|permissions|rls|security|policy|restrictions|guard)/i },
  { category: "prompt_injection", re: /(تجاوز|عطّل|ألغِ)\s+(الصلاحيات|الصلاحية|الحماية|القيود)/ },

  { category: "sensitive_personal_finance", re: /(payroll|salaries|salary\s+of|bank\s+account|iban|swift|credit\s+card|passport\s+number|national\s+id|id\s+number\s+of)/i },
  { category: "sensitive_personal_finance", re: /(الرواتب|رواتب|كشف\s+الرواتب|راتب\s+(الموظف|الموظّف)|الحساب\s+البنكي|آيبان|رقم\s+الهوية|جواز\s+السفر)/ },

  { category: "bulk_exfiltration", re: /(dump\s+(all|the)|export\s+(all|every)|list\s+all\s+(users|employees|clients|records|rows)|show\s+me\s+(everything|all\s+data)|select\s+\*)/i },
  { category: "bulk_exfiltration", re: /(صدّر|صدر|أخرج)\s+(كل|كلّ|جميع)\s*(البيانات|السجلات|السجلّات)/ },
  { category: "bulk_exfiltration", re: /(اعرض|أعطني)\s+(كل|كلّ|جميع)\s+(المستخدمين|الموظفين|الموظّفين|العملاء)/ },

  { category: "secret_request", re: /(api\s*key|service\s*role|secret\s*key|access\s*token|password|\.env|private\s+key|connection\s+string)/i },
  { category: "secret_request", re: /(كلمة\s+المرور|كلمة\s+السر|مفتاح\s+(الـ)?(api|الخدمة|السرّي)|رمز\s+الوصول)/ },

  { category: "sql_execution", re: /(drop\s+table|delete\s+from|insert\s+into|update\s+[a-z_]+\s+set|alter\s+table|grant\s+|truncate\s|pg_catalog|information_schema|union\s+select|;--)/i },
  { category: "sql_execution", re: /(اكتب|ولّد|أعطني)\s*(لي)?\s*(استعلام|كويري|sql|سكربت)/i },

  { category: "tool_invocation", re: /(call\s+the\s+(tool|function|api)|invoke\s+|run\s+(this\s+)?(command|script)|curl\s+http|fetch\(|http\s*request|send\s+(an\s+)?(email|message|whatsapp)\s+to)/i },
  { category: "tool_invocation", re: /(نفّذ|شغّل)\s+(الأمر|السكربت|الأداة)/ },
  { category: "tool_invocation", re: /(أرسل|ابعث)\s+(بريد|رسالة|واتساب)/ },
];

/** Every category this client-side mirror can raise. Used by the parity test. */
export const AI_GUARD_CATEGORIES: AiGuardCategory[] = [
  "prompt_injection", "sensitive_personal_finance", "bulk_exfiltration",
  "secret_request", "sql_execution", "tool_invocation",
];

/**
 * Advisory pre-flight. Returns the SAME shape as the database verdict.
 *
 * ⚠️ Read this before trusting it: a `blocked:false` here means NOTHING. The
 * database runs public.ai_guard_question() again on the server for every ask,
 * and it is the only decision that counts. This exists so an obvious attack
 * costs zero round-trips and so the refusal text is identical on both paths.
 */
export function aiPreflightGuard(question: string | null | undefined): AiGuardVerdict {
  const t = String(question ?? "");
  const cats: AiGuardCategory[] = [];
  for (const p of GUARD_PATTERNS) {
    if (p.re.test(t) && !cats.includes(p.category)) cats.push(p.category);
  }
  return {
    blocked: cats.length > 0,
    categories: cats,
    injection: { flagged: cats.includes("prompt_injection"), patterns: cats.includes("prompt_injection") ? ["client_preflight"] : [] },
  };
}

/** The local refusal, worded exactly like the server's. */
export function aiLocalRefusal(guard: AiGuardVerdict): AiAnswer {
  return {
    ok: false,
    refusal_code: "blocked_by_guard",
    answer: AI_REFUSAL_AR.blocked_by_guard,
    generated_text: null,
    retrieved_count: 0,
    citations: [],
    evidence: [],
    is_data_not_instructions: true,
    tool_execution: false,
    tools: [],
    guard,
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function aiAssistantState(): Promise<AiState<AiAssistantStatePayload>> {
  const r = await prpc<unknown>("ai_assistant_state");
  return toState(r, (d) => asRecord(d) as unknown as AiAssistantStatePayload);
}

export async function aiAdminOverview(): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_admin_overview");
  return toState(r, (d) => asRecord(d));
}

export async function aiKnowledgeList(
  status?: AiSourceStatus | null,
  search?: string | null,
): Promise<AiState<AiKnowledgeSource[]>> {
  const r = await prpc<unknown>("ai_knowledge_list", { p_status: status ?? null, p_search: search ?? null });
  return toState(r, (d) => asArray<AiKnowledgeSource>(d));
}

export async function aiConversationList(limit = 50): Promise<AiState<AiConversationRow[]>> {
  const r = await prpc<unknown>("ai_conversation_list", { p_limit: limit });
  return toState(r, (d) => asArray<AiConversationRow>(d));
}

export async function aiConversationMessages(conversationId: string): Promise<AiState<AiMessageRow[]>> {
  const r = await prpc<unknown>("ai_conversation_messages", { p_conversation: conversationId });
  return toState(r, (d) => asArray<AiMessageRow>(d));
}

export async function aiLeadList(status?: AiLeadStatus | null, limit = 100): Promise<AiState<AiLeadDraft[]>> {
  const r = await prpc<unknown>("ai_lead_list", { p_status: status ?? null, p_limit: limit });
  return toState(r, (d) => asArray<AiLeadDraft>(d));
}

// ─── The ask ────────────────────────────────────────────────────────────────

/**
 * Ask the internal assistant. Read the order — it IS the security model:
 *   1. advisory guard (may refuse locally, never permits)
 *   2. one RPC to the database, which guards AGAIN and only then retrieves
 *   3. the answer is returned as the server phrased it, with its citations
 *
 * The returned excerpts are sanitised for display here. Nothing in this
 * function interprets, executes, or follows retrieved text.
 */
export async function aiAsk(
  question: string,
  conversationId?: string | null,
): Promise<AiState<AiAnswer>> {
  const guard = aiPreflightGuard(question);
  if (guard.blocked) return { state: "ok", data: aiLocalRefusal(guard) };

  const r = await prpc<unknown>("ai_ask", {
    p_question: String(question ?? ""),
    p_conversation: conversationId ?? null,
  });
  return toState(r, (d) => {
    const o = asRecord(d);
    const evidence = asArray<Record<string, unknown>>(o.evidence).map((e) => ({
      ...(e as unknown as AiEvidence),
      excerpt: aiSanitizeForDisplay(String(e.excerpt ?? "")),
    }));
    return {
      ok: o.ok === true,
      conversation_id: (o.conversation_id as string) ?? undefined,
      message_id: (o.message_id as string) ?? undefined,
      refusal_code: (o.refusal_code as string) ?? null,
      answer: String(o.answer ?? ""),
      // ★ Never read a generated string out of the payload. V1 has none, and
      //   pinning null here means no screen can accidentally show one.
      generated_text: null,
      retrieved_count: Number(o.retrieved_count ?? 0),
      confidence: (o.confidence as AiConfidence) ?? undefined,
      citations: asArray<AiCitation>(o.citations),
      evidence,
      is_data_not_instructions: o.is_data_not_instructions === true,
      tool_execution: false,
      tools: [],
      guard: (o.guard as AiGuardVerdict) ?? undefined,
      provider: asRecord(o.provider),
      roles: asArray<AiAssistantRole>(o.roles),
    } as AiAnswer;
  });
}

// ─── Writes — knowledge registry ────────────────────────────────────────────

export async function aiSourceUpsert(input: Record<string, unknown>): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_source_upsert", { p_input: input });
  return toState(r, (d) => asRecord(d));
}

export async function aiSourceSubmit(sourceId: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_source_submit", { p_source_id: sourceId });
  return toState(r, (d) => asRecord(d));
}

export async function aiSourceApprove(sourceId: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_source_approve", { p_source_id: sourceId });
  return toState(r, (d) => asRecord(d));
}

export async function aiSourceReject(sourceId: string, reason: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_source_reject", { p_source_id: sourceId, p_reason: reason });
  return toState(r, (d) => asRecord(d));
}

export async function aiSourceArchive(sourceId: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_source_archive", { p_source_id: sourceId });
  return toState(r, (d) => asRecord(d));
}

// ─── Writes — conversations, leads, settings ────────────────────────────────

export async function aiConversationEscalate(conversationId: string, note: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_conversation_escalate", { p_conversation: conversationId, p_note: note });
  return toState(r, (d) => asRecord(d));
}

export async function aiConversationRedact(conversationId: string, reason: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_conversation_redact", { p_conversation: conversationId, p_reason: reason });
  return toState(r, (d) => asRecord(d));
}

export async function aiConversationDelete(conversationId: string, reason: string): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_conversation_delete", { p_conversation: conversationId, p_reason: reason });
  return toState(r, (d) => asRecord(d));
}

export async function aiLeadReview(
  draftId: string,
  status: AiLeadStatus,
  note: string,
): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_lead_review", { p_draft_id: draftId, p_status: status, p_note: note });
  return toState(r, (d) => asRecord(d));
}

export async function aiSettingsUpdate(input: Record<string, unknown>): Promise<AiState<Record<string, unknown>>> {
  const r = await prpc<unknown>("ai_settings_update", { p_input: input });
  return toState(r, (d) => asRecord(d));
}

// ─── Small presentation helpers (no invention, no misleading zero) ──────────

/** Freshness, never a bare number and never silently "fresh". */
export function freshnessLabelAr(days: number | null | undefined): string {
  if (days === null || days === undefined) return "حداثة غير معروفة";
  if (days <= 30) return `مُحدَّث خلال ${days} يومًا`;
  if (days <= 180) return `عمر المصدر ${days} يومًا`;
  return `⚠️ مصدر قديم (${days} يومًا) — راجعه قبل الاعتماد عليه`;
}

/** A citation line: title + version + freshness. All three, always. */
export function citationLineAr(c: AiCitation): string {
  const title = c.title_ar || c.source_title || "مصدر بلا عنوان";
  const type = AI_SOURCE_TYPE_AR[c.source_type] ?? c.source_type;
  return `${title} — ${type} — نسخة ${c.source_version} — ${freshnessLabelAr(c.freshness_days ?? null)}`;
}

export function refusalAr(code: string | null | undefined): string {
  if (!code) return "";
  return AI_REFUSAL_AR[code] ?? `طلب مرفوض (${code}).`;
}
