"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/* — shared chrome + auth shell for every portal route.
// ════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import PortalShell from "@/components/portal/PortalShell";

export default function ClientPortalLayout({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <section className="relative overflow-hidden" style={{ paddingTop: "140px", paddingBottom: "110px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
          <div className="relative z-10">
            <PortalShell>{children}</PortalShell>
          </div>
        </section>
      </main>
      <Footer />
    </I18nProvider>
  );
}
