// §6 Project timeline — role-scoped projection (client never sees admin/internal).
import { prpc, type Result } from "@/lib/portal/client";

export interface TimelineEvent {
  ts: string; actor: string | null; actor_name: string | null; role: string | null;
  event_type: string; entity_type: string; entity_id: string | null;
  visibility: "admin" | "internal" | "client"; meta: Record<string, unknown>;
}
export function projectTimeline(projectId: string, limit = 200): Promise<Result<TimelineEvent[]>> {
  return prpc<TimelineEvent[]>("project_timeline", { p_project: projectId, p_limit: limit });
}

// Human labels for event_type (AR/EN). Unknown types fall back to the raw type.
export const EVENT_LABELS: Record<string, { ar: string; en: string }> = {
  "deliverable.uploaded": { ar: "رُفع مخرَج", en: "Deliverable uploaded" },
  "deliverable.version_uploaded": { ar: "رُفعت نسخة جديدة", en: "New version uploaded" },
  "deliverable.version_added": { ar: "أُضيفت نسخة", en: "Version added" },
  "deliverable.status_changed": { ar: "تغيّرت حالة المخرَج", en: "Deliverable status changed" },
  "deliverable.final_delivered": { ar: "تم التسليم النهائي", en: "Final delivered" },
  "deliverable.final_version_set": { ar: "حُدِّدت النسخة النهائية", en: "Final version set" },
  "deliverable.note_resolved": { ar: "حُلّت ملاحظة", en: "Note resolved" },
  "deliverable.download_started": { ar: "بدأ العميل التنزيل", en: "Client started download" },
  "review.requested": { ar: "طُلبت مراجعة العميل", en: "Sent for client review" },
  "client.approved": { ar: "اعتمد العميل النسخة", en: "Client approved" },
  "client.revision_requested": { ar: "طلب العميل تعديلًا", en: "Client requested revision" },
  "delivery.payment_confirmed": { ar: "تأكيد استلام الدفعة", en: "Payment confirmed" },
  "delivery.payment_revoked": { ar: "سحب تأكيد الدفعة", en: "Payment revoked" },
  "delivery.release_policy_set": { ar: "ضبط سياسة التحرير", en: "Release policy set" },
};
