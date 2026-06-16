// ════════════════════════════════════════════════════════════════════════
// Kian Opportunities Center — config + data helpers.
// Public submission uses an ANON RPC (submit_opportunity_request, granted to
// anon) — the portal request() requires a session, so we call the RPC directly
// with the anon key here. Admin/HR reads & writes use the session-based client.
// Backed by docs/opportunities_center_RUNME.sql (owner runs it in Supabase).
// ════════════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_CONFIGURED } from "@/lib/portalAuth";
import { pget, prpc, enc, type Result } from "@/lib/portal/client";

export type Bi = { ar: string; en: string };
export type FieldType = "text" | "textarea" | "email" | "tel" | "url" | "date" | "select";
export interface OppField extends Bi { key: string; type: FieldType; required?: boolean; options?: (Bi & { value: string })[]; }
export interface OppType extends Bi { key: string; tagline: Bi; fields: OppField[]; }

// Shared fields rendered for every opportunity type (stored as top-level columns).
export const SHARED_FIELDS: OppField[] = [
  { key: "full_name", ar: "الاسم الكامل", en: "Full Name", type: "text", required: true },
  { key: "email",     ar: "البريد الإلكتروني", en: "Email", type: "email", required: true },
  { key: "phone",     ar: "رقم الجوال", en: "Phone", type: "tel", required: true },
  { key: "city",      ar: "المدينة", en: "City", type: "text" },
  { key: "message",   ar: "نبذة مختصرة عنك أو عن طلبك", en: "Short summary about you / your request", type: "textarea" },
];

const SEL = (key: string, ar: string, en: string, options: (Bi & { value: string })[], required = false): OppField =>
  ({ key, ar, en, type: "select", required, options });

const YESNO = (key: string, ar: string, en: string): OppField =>
  SEL(key, ar, en, [{ value: "yes", ar: "نعم", en: "Yes" }, { value: "no", ar: "لا", en: "No" }]);

export const OPPORTUNITY_TYPES: OppType[] = [
  {
    key: "job_application", ar: "طلب توظيف", en: "Job Application",
    tagline: { ar: "انضم لفريق كيان بدوام كامل.", en: "Join the Kian team full-time." },
    fields: [
      { key: "desired_position", ar: "الوظيفة المطلوبة", en: "Desired Position", type: "text", required: true },
      { key: "years_experience", ar: "سنوات الخبرة", en: "Years of Experience", type: "text", required: true },
      SEL("current_job_status", "الحالة الوظيفية الحالية", "Current Job Status", [
        { value: "employed", ar: "موظف", en: "Employed" }, { value: "unemployed", ar: "باحث عن عمل", en: "Seeking work" },
        { value: "student", ar: "طالب", en: "Student" }, { value: "freelancer", ar: "مستقل", en: "Freelancer" }], true),
      { key: "skills", ar: "أبرز المهارات", en: "Key Skills", type: "textarea", required: true },
      { key: "available_start_date", ar: "تاريخ الاستعداد للبدء", en: "Available Start Date", type: "date" },
      { key: "expected_salary", ar: "الراتب المتوقع (اختياري)", en: "Expected Salary (optional)", type: "text" },
      { key: "cv_url", ar: "رابط السيرة الذاتية", en: "CV URL", type: "url" },
      { key: "portfolio_url", ar: "رابط أعمالك", en: "Portfolio URL", type: "url" },
    ],
  },
  {
    key: "training", ar: "طلب تدريب", en: "Training Application",
    tagline: { ar: "تدرّب مع محترفي كيان.", en: "Train with Kian's professionals." },
    fields: [
      { key: "university_or_institution", ar: "الجامعة / الجهة التعليمية", en: "University / Institution", type: "text", required: true },
      { key: "major", ar: "التخصص", en: "Major", type: "text", required: true },
      SEL("training_type", "نوع التدريب", "Training Type", [
        { value: "summer", ar: "تدريب صيفي", en: "Summer" }, { value: "coop", ar: "تدريب تعاوني", en: "Co-op" },
        { value: "graduation_project", ar: "مشروع تخرّج", en: "Graduation Project" }, { value: "part_time", ar: "جزئي", en: "Part-time" }], true),
      { key: "required_training_period", ar: "المدة المطلوبة", en: "Required Period", type: "text", required: true },
      { key: "start_date", ar: "تاريخ البداية", en: "Start Date", type: "date" },
      { key: "end_date", ar: "تاريخ النهاية", en: "End Date", type: "date" },
      { key: "learning_goals", ar: "أهدافك من التدريب", en: "Learning Goals", type: "textarea", required: true },
      { key: "cv_url", ar: "رابط السيرة الذاتية", en: "CV URL", type: "url" },
      { key: "portfolio_url", ar: "رابط أعمالك", en: "Portfolio URL", type: "url" },
    ],
  },
  {
    key: "collaboration", ar: "طلب تعاون", en: "Collaboration Request",
    tagline: { ar: "تعاون مع كيان في مبادرة أو مشروع.", en: "Collaborate with Kian on an initiative." },
    fields: [
      { key: "organization_name", ar: "اسم الجهة", en: "Organization Name", type: "text", required: true },
      { key: "collaboration_type", ar: "نوع التعاون", en: "Collaboration Type", type: "text", required: true },
      { key: "project_summary", ar: "ملخّص المشروع", en: "Project Summary", type: "textarea", required: true },
      { key: "expected_scope", ar: "النطاق المتوقع", en: "Expected Scope", type: "textarea" },
      SEL("preferred_contact_method", "طريقة التواصل المفضلة", "Preferred Contact", [
        { value: "email", ar: "البريد", en: "Email" }, { value: "phone", ar: "الهاتف", en: "Phone" }, { value: "whatsapp", ar: "واتساب", en: "WhatsApp" }]),
      { key: "website_url", ar: "الموقع الإلكتروني", en: "Website URL", type: "url" },
    ],
  },
  {
    key: "co_production", ar: "طلب إنتاج مشترك", en: "Co-Production",
    tagline: { ar: "أنتج عملاً بصرياً بالشراكة مع كيان.", en: "Co-produce a visual project with Kian." },
    fields: [
      { key: "project_title", ar: "عنوان المشروع", en: "Project Title", type: "text", required: true },
      { key: "project_type", ar: "نوع المشروع", en: "Project Type", type: "text", required: true },
      SEL("production_stage", "مرحلة الإنتاج", "Production Stage", [
        { value: "idea", ar: "فكرة", en: "Idea" }, { value: "pre_production", ar: "ما قبل الإنتاج", en: "Pre-production" },
        { value: "in_production", ar: "قيد الإنتاج", en: "In production" }, { value: "post_production", ar: "ما بعد الإنتاج", en: "Post-production" }], true),
      { key: "target_platform", ar: "المنصة المستهدفة", en: "Target Platform", type: "text", required: true },
      { key: "required_support", ar: "الدعم المطلوب من كيان", en: "Required Support", type: "textarea", required: true },
      { key: "budget_range", ar: "نطاق الميزانية (اختياري)", en: "Budget Range (optional)", type: "text" },
      { key: "pitch_deck_url", ar: "رابط العرض التقديمي (اختياري)", en: "Pitch Deck URL (optional)", type: "url" },
    ],
  },
  {
    key: "freelancer", ar: "طلب انضمام كمستقل / فريلانسر", en: "Freelancer / Talent",
    tagline: { ar: "اعمل مع كيان على المشاريع كمستقل.", en: "Work with Kian on projects as a freelancer." },
    fields: [
      { key: "specialty", ar: "التخصص", en: "Specialty", type: "text", required: true },
      SEL("experience_level", "مستوى الخبرة", "Experience Level", [
        { value: "junior", ar: "مبتدئ", en: "Junior" }, { value: "mid", ar: "متوسط", en: "Mid" }, { value: "senior", ar: "محترف", en: "Senior" }], true),
      { key: "availability", ar: "مدى التفرّغ", en: "Availability", type: "text", required: true },
      { key: "portfolio_url", ar: "رابط أعمالك", en: "Portfolio URL", type: "url" },
      { key: "instagram_url", ar: "حساب إنستغرام", en: "Instagram URL", type: "url" },
      { key: "equipment_owned", ar: "المعدات التي تملكها (اختياري)", en: "Equipment Owned (optional)", type: "textarea" },
      { key: "day_rate", ar: "السعر اليومي (اختياري)", en: "Day Rate (optional)", type: "text" },
    ],
  },
  {
    key: "supplier", ar: "طلب مورد أو شريك خدمات", en: "Supplier / Service Partner",
    tagline: { ar: "قدّم خدماتك أو معداتك لكيان.", en: "Offer your services or equipment to Kian." },
    fields: [
      { key: "company_name", ar: "اسم الشركة", en: "Company Name", type: "text", required: true },
      { key: "service_category", ar: "فئة الخدمة", en: "Service Category", type: "text", required: true },
      { key: "service_areas", ar: "مناطق التغطية", en: "Service Areas", type: "text", required: true },
      { key: "website_url", ar: "الموقع الإلكتروني", en: "Website URL", type: "url" },
      { key: "commercial_registration", ar: "السجل التجاري (اختياري)", en: "Commercial Registration (optional)", type: "text" },
      { key: "vat_number", ar: "الرقم الضريبي (اختياري)", en: "VAT Number (optional)", type: "text" },
      { key: "previous_clients", ar: "عملاء سابقون (اختياري)", en: "Previous Clients (optional)", type: "textarea" },
    ],
  },
  {
    key: "media_partnership", ar: "طلب شراكة إعلامية أو إنتاجية", en: "Media / Production Partnership",
    tagline: { ar: "اعقد شراكة إعلامية مع كيان.", en: "Form a media partnership with Kian." },
    fields: [
      { key: "partner_name", ar: "اسم الشريك", en: "Partner Name", type: "text", required: true },
      { key: "partnership_type", ar: "نوع الشراكة", en: "Partnership Type", type: "text", required: true },
      { key: "audience_or_reach", ar: "حجم الجمهور / الوصول", en: "Audience / Reach", type: "text", required: true },
      { key: "platforms", ar: "المنصات", en: "Platforms", type: "text", required: true },
      { key: "proposal_summary", ar: "ملخّص المقترح", en: "Proposal Summary", type: "textarea", required: true },
      { key: "media_kit_url", ar: "رابط الملف الإعلامي (اختياري)", en: "Media Kit URL (optional)", type: "url" },
    ],
  },
  {
    key: "talent", ar: "طلب انضمام موهبة / مبدع", en: "Talent / Creator",
    tagline: { ar: "انضم كموهبة أو صانع محتوى مع كيان.", en: "Join as a talent or creator with Kian." },
    fields: [
      { key: "talent_type", ar: "نوع الموهبة", en: "Talent Type", type: "text", required: true },
      { key: "platforms", ar: "المنصات", en: "Platforms", type: "text", required: true },
      { key: "audience_size", ar: "حجم الجمهور (اختياري)", en: "Audience Size (optional)", type: "text" },
      { key: "portfolio_url", ar: "رابط أعمالك", en: "Portfolio URL", type: "url" },
      { key: "past_work_examples", ar: "أمثلة من أعمالك السابقة", en: "Past Work Examples", type: "textarea", required: true },
      { key: "collaboration_interest", ar: "نوع التعاون الذي يهمّك (اختياري)", en: "Collaboration Interest (optional)", type: "textarea" },
    ],
  },
  {
    key: "sponsorship", ar: "طلب تغطية أو رعاية مشتركة", en: "Coverage / Sponsorship",
    tagline: { ar: "اطلب تغطية أو رعاية لفعاليتك.", en: "Request coverage or sponsorship for your event." },
    fields: [
      { key: "event_name", ar: "اسم الفعالية", en: "Event Name", type: "text", required: true },
      { key: "event_date", ar: "تاريخ الفعالية", en: "Event Date", type: "date", required: true },
      { key: "event_location", ar: "مكان الفعالية", en: "Event Location", type: "text", required: true },
      { key: "sponsorship_type", ar: "نوع الرعاية / التغطية", en: "Sponsorship Type", type: "text", required: true },
      { key: "expected_deliverables", ar: "المخرجات المتوقعة", en: "Expected Deliverables", type: "textarea", required: true },
      { key: "audience_size", ar: "حجم الجمهور (اختياري)", en: "Audience Size (optional)", type: "text" },
    ],
  },
  {
    key: "volunteer", ar: "طلب تطوع أو مشاركة موسمية", en: "Volunteer / Seasonal",
    tagline: { ar: "تطوّع أو شارك في مواسم كيان.", en: "Volunteer or join Kian seasonally." },
    fields: [
      { key: "area_of_interest", ar: "مجال الاهتمام", en: "Area of Interest", type: "text", required: true },
      { key: "availability", ar: "مدى التفرّغ", en: "Availability", type: "text", required: true },
      { key: "experience", ar: "خبرتك (اختياري)", en: "Experience (optional)", type: "textarea" },
      { key: "preferred_role", ar: "الدور المفضّل (اختياري)", en: "Preferred Role (optional)", type: "text" },
    ],
  },
];

export const OPP_STATUS_LABELS: Record<string, Bi> = {
  new: { ar: "جديد", en: "New" },
  under_review: { ar: "قيد المراجعة", en: "Under Review" },
  shortlisted: { ar: "في القائمة المختصرة", en: "Shortlisted" },
  contacted: { ar: "تم التواصل", en: "Contacted" },
  interview_scheduled: { ar: "مقابلة مجدولة", en: "Interview Scheduled" },
  accepted: { ar: "مقبول", en: "Accepted" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  archived: { ar: "مؤرشف", en: "Archived" },
};
export const OPP_STATUSES = Object.keys(OPP_STATUS_LABELS);

export const OPP_PRIORITY_LABELS: Record<string, Bi> = {
  low: { ar: "منخفضة", en: "Low" },
  normal: { ar: "عادية", en: "Normal" },
  high: { ar: "عالية", en: "High" },
  urgent: { ar: "عاجلة", en: "Urgent" },
};
export const OPP_PRIORITIES = Object.keys(OPP_PRIORITY_LABELS);

export function oppTypeLabel(key: string): Bi {
  return OPPORTUNITY_TYPES.find((t) => t.key === key) ?? { ar: key, en: key };
}
export function oppFieldLabel(typeKey: string, fieldKey: string): Bi {
  const t = OPPORTUNITY_TYPES.find((x) => x.key === typeKey);
  return t?.fields.find((f) => f.key === fieldKey) ?? { ar: fieldKey, en: fieldKey };
}

// ─── Rows ───
export interface OpportunityRequest {
  id: string;
  request_number: string | null;
  opportunity_type: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  message: string | null;
  details: Record<string, string>;
  status: string;
  priority: string;
  assigned_to: string | null;
  consent: boolean;
  source: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}
export interface OpportunityNote {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

// ─── Public submit (ANON; no session) ───
export async function submitOpportunityRequest(input: {
  type: string; full_name: string; email?: string; phone?: string; city?: string;
  message?: string; details: Record<string, string>; consent: boolean;
}): Promise<Result<string>> {
  if (!SUPABASE_CONFIGURED) return { ok: false, error: "not_configured", status: 0 };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_opportunity_request`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_type: input.type, p_full_name: input.full_name, p_email: input.email ?? null,
        p_phone: input.phone ?? null, p_city: input.city ?? null, p_message: input.message ?? null,
        p_details: input.details, p_consent: input.consent,
      }),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const d = data as { message?: string; hint?: string } | null;
      return { ok: false, error: d?.message || d?.hint || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: String(data ?? "") };
  } catch (e) {
    return { ok: false, error: String(e), status: 0 };
  }
}

// ─── Admin/HR (session-based; RLS scopes to owner/admin/manager/hr) ───
export function listOpportunities(filters?: { type?: string; status?: string; priority?: string; search?: string }): Promise<Result<OpportunityRequest[]>> {
  const parts: string[] = ["is_deleted=eq.false", "select=*", "order=created_at.desc", "limit=500"];
  if (filters?.type) parts.push(`opportunity_type=eq.${enc(filters.type)}`);
  if (filters?.status) parts.push(`status=eq.${enc(filters.status)}`);
  if (filters?.priority) parts.push(`priority=eq.${enc(filters.priority)}`);
  if (filters?.search?.trim()) {
    const q = `*${filters.search.trim()}*`;
    parts.push(`or=(full_name.ilike.${enc(q)},email.ilike.${enc(q)},phone.ilike.${enc(q)},request_number.ilike.${enc(q)})`);
  }
  return pget<OpportunityRequest[]>(`opportunity_requests?${parts.join("&")}`);
}
export function listOpportunityNotes(requestId: string): Promise<Result<OpportunityNote[]>> {
  return pget<OpportunityNote[]>(`opportunity_request_notes?request_id=eq.${enc(requestId)}&is_deleted=eq.false&select=*&order=created_at.desc`);
}
export function updateOpportunityStatus(requestId: string, status: string): Promise<Result<boolean>> {
  return prpc<boolean>("update_opportunity_status", { p_request: requestId, p_status: status });
}
export function updateOpportunityPriority(requestId: string, priority: string): Promise<Result<boolean>> {
  return prpc<boolean>("update_opportunity_priority", { p_request: requestId, p_priority: priority });
}
export function addOpportunityNote(requestId: string, body: string): Promise<Result<string>> {
  return prpc<string>("add_opportunity_note", { p_request: requestId, p_body: body });
}
export function archiveOpportunityRequest(requestId: string): Promise<Result<boolean>> {
  return prpc<boolean>("archive_opportunity_request", { p_request: requestId });
}
