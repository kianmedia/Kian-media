"use client";
// /client-portal/quotes — role switch (S4 fix).
//   admin → AdminQuotesInbox (read all, expandable detail, no submission form)
//   lead/client → ClientQuotes (submit + own list)
import { usePortal } from "@/components/portal/PortalShell";
import ClientQuotes from "@/components/portal/ClientQuotes";
import AdminQuotesInbox from "@/components/portal/AdminQuotesInbox";

export default function QuotesPage() {
  const { profile } = usePortal();
  return profile.account_type === "admin" ? <AdminQuotesInbox /> : <ClientQuotes />;
}
