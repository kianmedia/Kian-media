// ════════════════════════════════════════════════════════════════════════
// Kian Portal — invoices read. RLS scopes rows: owner/admin/manager/finance see
// all; a client sees only their own. Invoices are written server-side by the
// (future) Zoho sync — never from the browser. Empty until Zoho is wired.
// ════════════════════════════════════════════════════════════════════════
import { pget, type Result } from "@/lib/portal/client";
import type { Invoice } from "@/lib/portal/types";

export function listInvoices(limit = 200): Promise<Result<Invoice[]>> {
  return pget<Invoice[]>(`invoices?is_deleted=eq.false&select=*&order=created_at.desc&limit=${limit}`);
}
