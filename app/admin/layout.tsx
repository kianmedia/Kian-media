"use client";
// ════════════════════════════════════════════════════════════════════════
// /admin/* — chrome for the internal admin tools (WhatsApp inbox, …).
// Separate from /client-portal/* so it never touches the client portal shell.
// ════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <main style={{ background: "#050505", minHeight: "100vh", color: "#fff" }}>
        {children}
      </main>
    </I18nProvider>
  );
}
