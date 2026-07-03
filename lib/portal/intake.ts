// ════════════════════════════════════════════════════════════════════════
// Kian Portal — the client's own website submissions (public_intake), linked by
// their VERIFIED email. Reads are RLS-scoped (own by email/user_id). On portal
// load we call link_my_records_by_email() so guest submissions + email-matched
// quotes attach to the signed-in user. Mirrors docs/portal_email_linking_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, type Result } from "@/lib/portal/client";

export type IntakeType = "quote" | "meeting" | "call" | "files" | "contact" | "other";

export interface PublicIntake {
  id: string;
  user_id: string | null;
  request_type: IntakeType;
  reference: string | null;
  email: string;
  phone: string | null;
  full_name: string | null;
  company: string | null;
  city: string | null;
  services: string[] | null;
  details: string | null;
  preferred_date: string | null;
  preferred_contact: string | null;
  file_links: { label?: string; url: string }[] | null;
  status: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export const INTAKE_TYPE_LABELS: Record<IntakeType, { ar: string; en: string }> = {
  quote:   { ar: "طلب عرض سعر", en: "Quote request" },
  meeting: { ar: "حجز اجتماع",  en: "Meeting" },
  call:    { ar: "مكالمة",      en: "Call" },
  files:   { ar: "رفع ملفات",   en: "Files" },
  contact: { ar: "تواصل",       en: "Contact" },
  other:   { ar: "طلب",         en: "Request" },
};
export const INTAKE_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  new:       { ar: "جديد",       en: "New" },
  reviewing: { ar: "قيد المراجعة", en: "In review" },
  quoted:    { ar: "تم التسعير",  en: "Quoted" },
  scheduled: { ar: "مجدول",      en: "Scheduled" },
  completed: { ar: "مكتمل",      en: "Completed" },
  closed:    { ar: "مغلق",       en: "Closed" },
};

export function listMyIntake(): Promise<Result<PublicIntake[]>> {
  return pget<PublicIntake[]>(`public_intake?is_deleted=eq.false&select=*&order=created_at.desc`);
}

/** Attach this user's email-matched guest submissions + quotes to their account. */
export function linkMyRecords(): Promise<Result<{ linked_intake: number; linked_quotes: number; has_client: boolean; recognized: boolean }>> {
  return prpc<{ linked_intake: number; linked_quotes: number; has_client: boolean; recognized: boolean }>("link_my_records_by_email", {});
}
