// §4 Pre-production center — structured planning items (RLS-scoped reads, RPC writes).
import { pget, prpc, enc, type Result } from "@/lib/portal/client";

export type PreproStatus = "todo" | "in_progress" | "blocked" | "done";
export interface PreproAttachment { name: string; url: string; kind?: "link" | "file"; size?: number | null; mime?: string | null; by?: string | null; at?: string | null }
export interface PreproItem {
  id: string; project_id: string; section: string; title: string; body: string | null;
  detail: Record<string, unknown>; attachments: PreproAttachment[];
  owner_id: string | null; profession: string | null; due_date: string | null;
  status: PreproStatus; priority: "low" | "normal" | "high" | "urgent";
  client_visible: boolean; needs_approval: boolean; approved_by: string | null; approved_at: string | null;
  sort_order: number; created_at: string; updated_at: string;
  // P0-3 additions
  contact_name?: string | null; contact_mobile?: string | null;
  needs_internal_approval?: boolean; internal_approved_by?: string | null; internal_approved_at?: string | null;
  is_active?: boolean; notes?: string | null;
}
export interface PreproComment { id: string; item_id: string; author_id: string | null; body: string; created_at: string }

export function listPreproItems(projectId: string): Promise<Result<PreproItem[]>> {
  return pget<PreproItem[]>(`preproduction_items?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=section.asc,sort_order.asc,created_at.asc`);
}
export function upsertPreproItem(projectId: string, data: Record<string, unknown>): Promise<Result<PreproItem>> {
  return prpc<PreproItem>("preproduction_upsert", { p_project: projectId, p_data: data });
}
export function deletePreproItem(id: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("preproduction_delete", { p_id: id, p_reason: reason });
}
export function approvePreproItem(id: string): Promise<Result<boolean>> {
  return prpc<boolean>("preproduction_approve", { p_id: id });
}
export function internalApprovePreproItem(id: string): Promise<Result<null>> {
  return prpc<null>("preproduction_internal_approve", { p_id: id });
}
export function duplicatePreproItem(id: string): Promise<Result<PreproItem>> {
  return prpc<PreproItem>("preproduction_duplicate", { p_id: id });
}
export function setPreproActive(id: string, active: boolean): Promise<Result<null>> {
  return prpc<null>("preproduction_set_active", { p_id: id, p_active: active });
}
export function restorePreproItem(id: string): Promise<Result<null>> {
  return prpc<null>("preproduction_restore", { p_id: id });
}
export function listPreproComments(itemId: string): Promise<Result<PreproComment[]>> {
  return pget<PreproComment[]>(`preproduction_comments?item_id=eq.${enc(itemId)}&is_deleted=eq.false&select=*&order=created_at.asc`);
}
export function addPreproComment(itemId: string, body: string): Promise<Result<string>> {
  return prpc<string>("preproduction_comment", { p_item: itemId, p_body: body });
}

// The fixed section taxonomy (AR/EN labels), in production order.
export const PREPRO_SECTIONS: { key: string; ar: string; en: string }[] = [
  { key: "client_brief", ar: "موجز العميل", en: "Client Brief" },
  { key: "objectives", ar: "الأهداف", en: "Objectives" },
  { key: "audience", ar: "الجمهور المستهدف", en: "Target Audience" },
  { key: "key_message", ar: "الرسالة الأساسية", en: "Key Message" },
  { key: "concept", ar: "الفكرة الإبداعية", en: "Creative Concept" },
  { key: "treatment", ar: "المعالجة", en: "Treatment" },
  { key: "script", ar: "السيناريو", en: "Script" },
  { key: "interview_questions", ar: "أسئلة المقابلة", en: "Interview Questions" },
  { key: "storyboard", ar: "الستوري بورد", en: "Storyboard" },
  { key: "shot_list", ar: "قائمة اللقطات", en: "Shot List" },
  { key: "scene_list", ar: "قائمة المشاهد", en: "Scene List" },
  { key: "locations", ar: "المواقع", en: "Locations" },
  { key: "permits", ar: "التصاريح", en: "Permits" },
  { key: "drone_permits", ar: "تصاريح الدرون", en: "Drone Permits" },
  { key: "cast", ar: "الطاقم الظاهر/الضيوف", en: "Cast / Guests" },
  { key: "wardrobe", ar: "الأزياء", en: "Wardrobe" },
  { key: "props", ar: "الإكسسوارات", en: "Props" },
  { key: "equipment", ar: "المعدات", en: "Equipment" },
  { key: "crew_plan", ar: "خطة الطاقم", en: "Crew Plan" },
  { key: "filming_schedule", ar: "جدول التصوير", en: "Filming Schedule" },
  { key: "call_sheet", ar: "Call Sheet", en: "Call Sheet" },
  { key: "logistics", ar: "اللوجستيات", en: "Logistics" },
  { key: "health_safety", ar: "الصحة والسلامة", en: "Health & Safety" },
  { key: "risk_assessment", ar: "تقييم المخاطر", en: "Risk Assessment" },
  { key: "contingency", ar: "خطة الطوارئ", en: "Contingency Plan" },
  { key: "client_references", ar: "مراجع العميل", en: "Client References" },
  { key: "brand_assets", ar: "أصول العلامة", en: "Brand Assets" },
  { key: "approvals", ar: "الاعتمادات", en: "Approvals" },
];
// Sections that use a structured detail form (not just body text).
export const STORYBOARD_FIELDS = ["scene_number", "camera", "movement", "dialogue", "location", "cast", "props", "duration", "frame_ref"] as const;
export const SHOTLIST_FIELDS = ["shot_number", "scene", "shot_type", "lens", "camera", "movement", "frame_rate", "location", "subject", "audio", "lighting", "drone", "responsible", "filming_status"] as const;
