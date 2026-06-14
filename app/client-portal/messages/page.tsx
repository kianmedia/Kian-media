"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/messages — role switch (S4).
//   admin → AdminMessagesInbox (all threads, derived status, manual reply)
//   lead/client → ClientMessages (own thread only; RLS-enforced isolation)
// ════════════════════════════════════════════════════════════════════════
import { usePortal } from "@/components/portal/PortalShell";
import ClientMessages from "@/components/portal/ClientMessages";
import AdminMessagesInbox from "@/components/portal/AdminMessagesInbox";

export default function MessagesPage() {
  const { profile } = usePortal();
  return profile.account_type === "admin" ? <AdminMessagesInbox /> : <ClientMessages />;
}
