// ════════════════════════════════════════════════════════════════════════
// Kian Operations Platform · Module 1 — Testimonials client.
//
// - Public READ (homepage) + public SUBMIT go through ANON RPCs (granted to
//   `anon`); no session required, and failures degrade gracefully so the
//   homepage can keep its elegant empty-state fallback.
// - Admin moderation goes through session-based RPCs (civ_can_manage-guarded)
//   and PostgREST reads (RLS-scoped to managers). Anon/public key only.
// ════════════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_CONFIGURED } from "@/lib/portalAuth";
import { pget, prpc, enc, type Result } from "@/lib/portal/client";

// ─── Types ───
export interface PublicTestimonial {
  id: string;
  client_name: string;
  client_title: string | null;
  company: string | null;
  rating: number | null;
  body: string;
  lang: "ar" | "en";
  is_featured: boolean;
}

export interface AdminTestimonial extends PublicTestimonial {
  project_ref: string | null;
  source: "public_form" | "admin" | "invite";
  status: "pending" | "approved" | "rejected" | "hidden";
  display_order: number;
  consent: boolean;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestimonialsAdminSettings {
  enabled: boolean;
  pending: number;
  approved: number;
}

export const TESTIMONIAL_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  pending:  { ar: "بانتظار المراجعة", en: "Pending" },
  approved: { ar: "معتمدة",           en: "Approved" },
  rejected: { ar: "مرفوضة",           en: "Rejected" },
  hidden:   { ar: "مخفية",            en: "Hidden" },
};

/** Map a submit RPC error key to an Arabic message. */
export function testimonialErrorAr(raw: string): string {
  const r = (raw || "").toLowerCase();
  if (r.includes("name_invalid")) return "الاسم مطلوب (حرفان على الأقل).";
  if (r.includes("body_invalid")) return "نص التجربة قصير جدًا (١٠ أحرف على الأقل).";
  if (r.includes("rating_invalid")) return "التقييم يجب أن يكون بين ١ و٥.";
  if (r.includes("consent_required")) return "يلزم الموافقة على نشر التجربة.";
  if (r.includes("rate_limited")) return "تم استقبال عدة مشاركات منك مؤخرًا. الرجاء المحاولة بعد قليل.";
  if (r.includes("not_configured")) return "الخدمة غير مهيأة بعد.";
  return "تعذّر إرسال التجربة. حاول مرة أخرى.";
}

// ─── Public READ (anon; homepage) — never throws; degrades to disabled/empty ───
export async function fetchPublicTestimonials(
  limit = 12,
): Promise<{ enabled: boolean; items: PublicTestimonial[] }> {
  if (!SUPABASE_CONFIGURED) return { enabled: false, items: [] };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kian_public_testimonials`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: limit }),
    });
    if (!res.ok) return { enabled: false, items: [] };
    const data = (await res.json()) as { enabled?: boolean; items?: PublicTestimonial[] } | null;
    return {
      enabled: !!data?.enabled,
      items: Array.isArray(data?.items) ? (data!.items as PublicTestimonial[]) : [],
    };
  } catch {
    return { enabled: false, items: [] };
  }
}

// ─── Public SUBMIT (anon; no session) ───
export async function submitTestimonial(input: {
  name: string; body: string; title?: string; company?: string;
  rating?: number | null; lang?: "ar" | "en"; project_ref?: string; consent: boolean;
}): Promise<Result<{ id: string }>> {
  if (!SUPABASE_CONFIGURED) return { ok: false, error: "not_configured", status: 0 };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kian_submit_testimonial`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_name: input.name, p_body: input.body,
        p_title: input.title ?? null, p_company: input.company ?? null,
        p_rating: input.rating ?? null, p_lang: input.lang ?? "ar",
        p_project_ref: input.project_ref ?? null, p_consent: input.consent,
      }),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const d = data as { message?: string; hint?: string } | null;
      return { ok: false, error: d?.message || d?.hint || `HTTP ${res.status}`, status: res.status };
    }
    const d = data as { id?: string } | null;
    return { ok: true, data: { id: String(d?.id ?? "") } };
  } catch (e) {
    return { ok: false, error: String(e), status: 0 };
  }
}

// ─── Admin (session-based; RLS + civ_can_manage) ───
export function listTestimonials(status?: string): Promise<Result<AdminTestimonial[]>> {
  const parts = ["select=*", "order=status.asc,is_featured.desc,display_order.asc,created_at.desc", "limit=500"];
  if (status) parts.push(`status=eq.${enc(status)}`);
  return pget<AdminTestimonial[]>(`kian_testimonials?${parts.join("&")}`);
}

export function testimonialsAdminSettings(): Promise<Result<TestimonialsAdminSettings>> {
  return prpc<TestimonialsAdminSettings>("kian_testimonials_admin_settings");
}

export function setTestimonialsEnabled(enabled: boolean): Promise<Result<{ ok: boolean; enabled: boolean }>> {
  return prpc<{ ok: boolean; enabled: boolean }>("kian_testimonials_set_enabled", { p_enabled: enabled });
}

export function moderateTestimonial(id: string, status: string, reason?: string): Promise<Result<unknown>> {
  return prpc("kian_testimonials_moderate", { p_id: id, p_status: status, p_reason: reason ?? null });
}

export function setTestimonialFeature(id: string, featured: boolean, order?: number): Promise<Result<unknown>> {
  return prpc("kian_testimonials_set_feature", { p_id: id, p_featured: featured, p_order: order ?? null });
}

export function adminCreateTestimonial(input: {
  name: string; body: string; title?: string; company?: string;
  rating?: number | null; lang?: "ar" | "en"; project_ref?: string; featured?: boolean;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("kian_testimonials_admin_create", {
    p_name: input.name, p_body: input.body,
    p_title: input.title ?? null, p_company: input.company ?? null,
    p_rating: input.rating ?? null, p_lang: input.lang ?? "ar",
    p_project_ref: input.project_ref ?? null, p_featured: input.featured ?? false,
  });
}
