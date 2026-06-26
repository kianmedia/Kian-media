// ════════════════════════════════════════════════════════════════════════
// Kian Portal — Notification Delivery Layer (Stage 1) read model. Staff-only
// (can_manage_quotes via the list_deliveries SECURITY DEFINER RPC + RLS). Clients
// never read this table. Mirrors docs/portal_notification_delivery_stage1_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";

export type DeliveryChannel = "portal" | "email" | "whatsapp";
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped" | "dry_run";
export type DeliveryRole = "client" | "admin" | "owner" | "sales" | "finance" | "system";

export interface NotificationDelivery {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  recipient_user_id: string | null;
  recipient_role: DeliveryRole;
  channel: DeliveryChannel;
  destination_email: string | null;
  destination_phone: string | null;
  status: DeliveryStatus;
  skip_reason: string | null;
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  payload: Record<string, unknown> | null;
  idempotency_key: string;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
  claimed_at?: string | null;
}

export function listDeliveries(limit = 300, entityId?: string): Promise<Result<NotificationDelivery[]>> {
  return prpc<NotificationDelivery[]>("list_deliveries", { p_limit: limit, p_entity: entityId ?? null });
}

/** Admin: requeue a failed/skipped row (gated can_manage_quotes server-side). */
export function retryDelivery(id: string): Promise<Result<boolean>> {
  return prpc<boolean>("retry_delivery", { p_id: id });
}

/** Admin "process now": triggers the processor with the staff bearer (no secret needed). */
export async function processPending(): Promise<Result<{ claimed: number; sent: number; failed: number; skipped: number; dry_run: number; disabled?: boolean }>> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated", status: 401 };
  try {
    const res = await fetch("/api/integrations/deliveries/process", {
      method: "POST", headers: { Authorization: `Bearer ${s.access_token}` },
    });
    const d = await res.json();
    if (!res.ok || !d.ok) return { ok: false, error: d.error || `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: d };
  } catch (e) { return { ok: false, error: String(e) }; }
}

export const EVENT_LABELS: Record<string, { ar: string; en: string }> = {
  new_quote_request:         { ar: "طلب عرض سعر جديد",   en: "New quote request" },
  estimate_created:          { ar: "تم إنشاء تقدير",      en: "Estimate created" },
  estimate_synced:           { ar: "مزامنة تقدير",        en: "Estimate synced" },
  estimate_published:        { ar: "نشر التقدير للعميل",  en: "Estimate published" },
  client_approved:           { ar: "موافقة العميل",       en: "Client approved" },
  client_rejected:           { ar: "رفض العميل",          en: "Client rejected" },
  client_requested_revision: { ar: "طلب تعديل من العميل",  en: "Revision requested" },
  draft_invoice_created:     { ar: "مسودة فاتورة",        en: "Draft invoice created" },
  official_invoice_issued:   { ar: "إصدار فاتورة رسمية",  en: "Official invoice issued" },
};

export const STATUS_STYLE: Record<DeliveryStatus, { bg: string; fg: string }> = {
  sent:    { bg: "rgba(37,211,102,0.16)",  fg: "#7ee2a8" },
  pending: { bg: "rgba(245,200,66,0.16)",  fg: "#f5d76e" },
  dry_run: { bg: "rgba(99,179,237,0.16)",  fg: "#90cdf4" },
  skipped: { bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.55)" },
  failed:  { bg: "rgba(227,30,36,0.16)",   fg: "#ff9ea1" },
};
