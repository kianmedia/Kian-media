"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/* — shared chrome + auth shell for every portal route.
// Project Core (منصّة الإدارة الداخلية) drops the marketing Footer / WhatsApp
// float / large hero padding and goes wider — it is not a marketing surface.
// ════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { I18nProvider } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import PortalShell from "@/components/portal/PortalShell";

export default function ClientPortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOps = !!pathname?.startsWith("/client-portal/project-core");   // منصّة الإدارة الداخلية
  return (
    <I18nProvider>
      {!isOps && <WaFloat />}
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <section className="relative overflow-hidden" style={{ paddingTop: isOps ? "96px" : "140px", paddingBottom: isOps ? "40px" : "110px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
          <div className="relative z-10">
            <PortalShell wide={isOps}>{children}</PortalShell>
          </div>
        </section>
      </main>
      {!isOps && <Footer />}
    </I18nProvider>
  );
}
