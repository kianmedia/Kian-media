"use client";
// /client-portal/admin/whatsapp — WhatsApp Inbox inside the portal admin area.
// Reuses the same component as /admin/whatsapp; PortalShell already auth-gates,
// and WhatsAppInbox role-gates (client/lead → denied). Suspense wraps it because
// it reads ?conversation=<id> via useSearchParams.
import { Suspense } from "react";
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";

export default function ClientPortalWhatsAppPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "rgba(255,255,255,0.5)" }}>Loading…</div>}>
      <WhatsAppInbox />
    </Suspense>
  );
}
