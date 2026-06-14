"use client";
// /client-portal/files — role switch (S4 fix).
//   admin → AdminFilesInbox (read all client links, actionable cards)
//   lead/client → ClientFiles (submit + own list)
import { usePortal } from "@/components/portal/PortalShell";
import ClientFiles from "@/components/portal/ClientFiles";
import AdminFilesInbox from "@/components/portal/AdminFilesInbox";

export default function FilesPage() {
  const { profile } = usePortal();
  return profile.account_type === "admin" ? <AdminFilesInbox /> : <ClientFiles />;
}
