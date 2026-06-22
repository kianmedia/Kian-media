"use client";
// /client-portal/quotes — role switch.
//   admin → AdminQuotesInbox (read all, expandable detail, no submission form)
//   sales/manager/super_admin (can_see_financials RLS) → AdminQuotesInbox (read-only)
//   lead/client → ClientQuotes (submit + own list)
import { usePortal } from "@/components/portal/PortalShell";
import ClientQuotes from "@/components/portal/ClientQuotes";
import ClientQuotesList from "@/components/portal/ClientQuotesList";
import AdminQuotesInbox from "@/components/portal/AdminQuotesInbox";
import AdminQuotesManager from "@/components/portal/AdminQuotesManager";

export default function QuotesPage() {
  const { profile, caps } = usePortal();
  // Financiers: intake inbox (read-only) + formal-quote management.
  if (profile.account_type === "admin" || caps.canSeeFinancials) {
    return <><AdminQuotesInbox /><AdminQuotesManager /></>;
  }
  // Client/lead: submit a request + read-only formal quotes (accept / request revision).
  return <><ClientQuotes /><ClientQuotesList /></>;
}
