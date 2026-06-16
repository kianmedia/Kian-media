"use client";
// /client-portal/quotes — role switch.
//   admin → AdminQuotesInbox (read all, expandable detail, no submission form)
//   sales/manager/super_admin (can_see_financials RLS) → AdminQuotesInbox (read-only)
//   lead/client → ClientQuotes (submit + own list)
import { usePortal } from "@/components/portal/PortalShell";
import ClientQuotes from "@/components/portal/ClientQuotes";
import AdminQuotesInbox from "@/components/portal/AdminQuotesInbox";

export default function QuotesPage() {
  const { profile, caps } = usePortal();
  // AdminQuotesInbox is already read-only (expand-only; no write controls).
  if (profile.account_type === "admin" || caps.canSeeFinancials) return <AdminQuotesInbox />;
  return <ClientQuotes />;
}
