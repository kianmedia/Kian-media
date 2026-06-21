// ════════════════════════════════════════════════════════════════════════
// Kian Portal — visitor/lead intake domain (Phase 4): project briefs + generic
// portal requests. Reads are RLS-scoped (own rows). Writes go through the
// SECURITY DEFINER RPCs submit_project_brief / submit_portal_request so sales is
// notified server-side. Mirrors docs/portal_visitor_intake_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, type Result } from "@/lib/portal/client";

export type PortalRequestType = "quote" | "meeting" | "call" | "contact" | "whatsapp" | "support" | "brief";
export type PortalRequestStatus = "new" | "assigned" | "in_progress" | "waiting_client" | "completed" | "closed";
export type ProjectBriefStatus = "new" | "reviewing" | "contacted" | "converted" | "closed";

export interface ProjectBrief {
  id: string;
  user_id: string | null;
  email: string | null;
  service_type: string | null;
  goal: string | null;
  city: string | null;
  expected_date: string | null;
  deliverables: string[] | null;
  budget_range: string | null;
  notes: string | null;
  ai_summary: string | null;
  status: ProjectBriefStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface PortalRequest {
  id: string;
  user_id: string | null;
  email: string | null;
  phone: string | null;
  request_type: PortalRequestType;
  status: PortalRequestStatus;
  title: string | null;
  summary: string | null;
  source: string | null;
  assigned_department: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export const PORTAL_REQUEST_STATUS_LABELS: Record<PortalRequestStatus, { ar: string; en: string }> = {
  new:            { ar: "جديد",          en: "New" },
  assigned:       { ar: "تم الإسناد",    en: "Assigned" },
  in_progress:    { ar: "قيد التنفيذ",   en: "In progress" },
  waiting_client: { ar: "بانتظار العميل", en: "Waiting on you" },
  completed:      { ar: "مكتمل",         en: "Completed" },
  closed:         { ar: "مغلق",          en: "Closed" },
};

export const PORTAL_REQUEST_TYPE_LABELS: Record<PortalRequestType, { ar: string; en: string }> = {
  quote:    { ar: "عرض سعر",   en: "Quote" },
  meeting:  { ar: "اجتماع",    en: "Meeting" },
  call:     { ar: "مكالمة",    en: "Call" },
  contact:  { ar: "تواصل",     en: "Contact" },
  whatsapp: { ar: "واتساب",    en: "WhatsApp" },
  support:  { ar: "دعم",       en: "Support" },
  brief:    { ar: "موجز مشروع", en: "Project brief" },
};

export function listMyBriefs(): Promise<Result<ProjectBrief[]>> {
  return pget<ProjectBrief[]>(`project_briefs?select=*&order=created_at.desc`);
}

export function listMyPortalRequests(): Promise<Result<PortalRequest[]>> {
  return pget<PortalRequest[]>(`portal_requests?select=*&order=created_at.desc`);
}

export interface NewBriefInput {
  serviceType: string; goal: string; city: string; expectedDate?: string | null;
  deliverables: string[]; budgetRange?: string; notes?: string; aiSummary?: string;
}

export function submitBrief(input: NewBriefInput): Promise<Result<string>> {
  return prpc<string>("submit_project_brief", {
    p_service_type: input.serviceType || null,
    p_goal: input.goal || null,
    p_city: input.city || null,
    p_expected_date: input.expectedDate || null,
    p_deliverables: input.deliverables ?? [],
    p_budget_range: input.budgetRange || null,
    p_notes: input.notes || null,
    p_ai_summary: input.aiSummary || null,
  });
}

export function submitPortalRequest(input: {
  type: PortalRequestType; title: string; summary?: string; phone?: string; source?: string;
}): Promise<Result<string>> {
  return prpc<string>("submit_portal_request", {
    p_request_type: input.type, p_title: input.title || null,
    p_summary: input.summary || null, p_phone: input.phone || null, p_source: input.source || "portal",
  });
}

/** Rule-based (NO AI) bilingual brief summary built client-side from the inputs. */
export function buildBriefSummary(i: NewBriefInput, isAr: boolean): string {
  const parts: string[] = [];
  if (isAr) {
    if (i.serviceType) parts.push(`الخدمة: ${i.serviceType}`);
    if (i.goal) parts.push(`الهدف: ${i.goal}`);
    if (i.city) parts.push(`المدينة: ${i.city}`);
    if (i.expectedDate) parts.push(`التاريخ المتوقع: ${i.expectedDate}`);
    if (i.deliverables.length) parts.push(`المخرجات: ${i.deliverables.join("، ")}`);
    if (i.budgetRange) parts.push(`الميزانية: ${i.budgetRange}`);
    return parts.join(" · ") || "موجز مشروع";
  }
  if (i.serviceType) parts.push(`Service: ${i.serviceType}`);
  if (i.goal) parts.push(`Goal: ${i.goal}`);
  if (i.city) parts.push(`City: ${i.city}`);
  if (i.expectedDate) parts.push(`Expected: ${i.expectedDate}`);
  if (i.deliverables.length) parts.push(`Deliverables: ${i.deliverables.join(", ")}`);
  if (i.budgetRange) parts.push(`Budget: ${i.budgetRange}`);
  return parts.join(" · ") || "Project brief";
}
