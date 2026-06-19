"use client";
// /admin/whatsapp — WhatsApp Inbox (Phase 4). Suspense wraps the inbox because
// it reads ?conversation=<id> via useSearchParams.
import { Suspense } from "react";
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";

export default function WhatsAppAdminPage() {
  return (
    <Suspense fallback={<div style={{ padding: 48, color: "rgba(255,255,255,0.5)" }}>Loading…</div>}>
      <WhatsAppInbox />
    </Suspense>
  );
}
