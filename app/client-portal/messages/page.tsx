"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/messages — role switch.
//   account_type=admin → AdminMessagesInbox (reply enabled)
//   support/manager/super_admin (can_support RLS) → AdminMessagesInbox (read-only)
//   lead/client → ClientMessages (own thread only; RLS-enforced isolation)
// ════════════════════════════════════════════════════════════════════════
import { usePortal } from "@/components/portal/PortalShell";
import ClientMessages from "@/components/portal/ClientMessages";
import AdminMessagesInbox from "@/components/portal/AdminMessagesInbox";

export default function MessagesPage() {
  const { profile, caps } = usePortal();
  if (profile.account_type === "admin") return <AdminMessagesInbox />;
  if (caps.canSupportComms) return <AdminMessagesInbox readOnly />;
  return <ClientMessages />;
}
