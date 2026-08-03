"use client";
// /client-portal/files — role switch.
//   admin → AdminFilesInbox (read all client links)
//   support/manager/super_admin/readonly (file RLS) → AdminFilesInbox (read-only list)
//   lead/client → ClientFiles (submit + own list)
import { usePortal } from "@/components/portal/PortalShell";
import ClientFiles from "@/components/portal/ClientFiles";
import AdminFilesInbox from "@/components/portal/AdminFilesInbox";

export default function FilesPage() {
  const { profile, caps } = usePortal();
  // AdminFilesInbox is read-only (link cards; no write controls).
  if (profile.account_type === "admin" || caps.canSupportComms || caps.staffReadsAll) return <AdminFilesInbox />;
  return <ClientFiles />;
}
