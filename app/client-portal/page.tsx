"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import {
  login, logout, getValidSession, fetchClient, fetchProjects,
  type Session, type ClientRow, type ProjectRow,
} from "@/lib/portalAuth";

// ─── Project status timeline (order matters) ───
const STATUS_STEPS = [
  { key: "request_received",   ar: "استلام الطلب",     en: "Request Received" },
  { key: "pre_production",     ar: "مرحلة التحضير",    en: "Pre-Production" },
  { key: "shooting_scheduled", ar: "جدولة التصوير",    en: "Shooting Scheduled" },
  { key: "shooting_completed", ar: "اكتمال التصوير",   en: "Shooting Completed" },
  { key: "editing",            ar: "المونتاج",          en: "Editing" },
  { key: "ready_for_review",   ar: "جاهز للمراجعة",    en: "Ready for Review" },
  { key: "delivered",          ar: "تم التسليم",        en: "Delivered" },
];

const DELIVERY_LABELS: Record<string, { ar: string; en: string }> = {
  pending:     { ar: "قيد الانتظار", en: "Pending" },
  in_progress: { ar: "جارٍ التجهيز", en: "In Progress" },
  delivered:   { ar: "تم التسليم",   en: "Delivered" },
};
const REVISION_LABELS: Record<string, { ar: string; en: string }> = {
  none:        { ar: "لا توجد مراجعات", en: "No Revisions" },
  in_revision: { ar: "قيد المراجعة",     en: "In Revision" },
  approved:    { ar: "معتمد",            en: "Approved" },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px",
  padding: "13px 15px",
  color: "#fff",
  fontSize: "15px",
  outline: "none",
};

function Portal() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "login" | "dash">("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // On mount: restore session if valid
  useEffect(() => {
    (async () => {
      const s = await getValidSession();
      if (s) {
        await enter(s);
      } else {
        setPhase("login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enter(s: Session) {
    const c = await fetchClient(s);
    if (!c) {
      // Auth ok but no client record linked — treat as not-provisioned
      logout();
      setErr(t({ ar: "حسابك غير مفعّل بعد — تواصل مع كيان ميديا.", en: "Your account isn't activated yet — please contact Kian Media." }));
      setPhase("login");
      return;
    }
    const ps = await fetchProjects(s, c.id);
    setSession(s);
    setClient(c);
    setProjects(ps);
    setPhase("dash");
  }

  async function onLogin() {
    setErr("");
    if (!email || !password) {
      setErr(t({ ar: "أدخل البريد وكلمة المرور", en: "Enter email and password" }));
      return;
    }
    setBusy(true);
    const r = await login(email.trim(), password);
    setBusy(false);
    if (!r.ok || !r.session) {
      setErr(t({ ar: "بيانات الدخول غير صحيحة", en: "Invalid email or password" }));
      return;
    }
    setBusy(true);
    await enter(r.session);
    setBusy(false);
  }

  function onLogout() {
    logout();
    setSession(null);
    setClient(null);
    setProjects([]);
    setEmail("");
    setPassword("");
    setPhase("login");
  }

  return (
    <>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <section className="relative overflow-hidden" style={{ paddingTop: "150px", paddingBottom: "110px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />

          <div className="max-w-4xl mx-auto px-5 sm:px-6 relative z-10">

            {/* ═══ LOADING ═══ */}
            {phase === "loading" && (
              <div className="text-center" style={{ padding: "120px 0" }}>
                <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                  {t({ ar: "جارٍ التحميل...", en: "Loading..." })}
                </div>
              </div>
            )}

            {/* ═══ LOGIN ═══ */}
            {phase === "login" && (
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}
                className="mx-auto" style={{ maxWidth: "440px" }}>
                <div className="text-center mb-10">
                  <div className="eyebrow mb-5 mx-auto">{t({ ar: "بوابة العملاء", en: "Client Portal" })}</div>
                  <h1 className="editorial text-white" style={{ fontSize: "clamp(30px,5vw,46px)", lineHeight: 1.25, marginBottom: "12px" }}>
                    {t({ ar: "تسجيل الدخول", en: "Sign In" })}
                  </h1>
                  <p className="text-white/55" style={{ fontSize: "14.5px", lineHeight: 1.7 }}>
                    {t({ ar: "تابع حالة مشاريعك مع كيان ميديا.", en: "Track your projects with Kian Media." })}
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div>
                    <label htmlFor="pe" className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                      {t({ ar: "البريد الإلكتروني", en: "Email" })}
                    </label>
                    <input id="pe" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle}
                      onKeyDown={(e) => { if (e.key === "Enter") onLogin(); }} />
                  </div>
                  <div>
                    <label htmlFor="pp" className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                      {t({ ar: "كلمة المرور", en: "Password" })}
                    </label>
                    <input id="pp" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle}
                      onKeyDown={(e) => { if (e.key === "Enter") onLogin(); }} />
                  </div>

                  {err && (
                    <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>
                      {err}
                    </div>
                  )}

                  <button onClick={onLogin} disabled={busy} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
                    <span>{busy ? "..." : t({ ar: "دخول", en: "Sign In" })}</span>
                  </button>

                  <p className="f-sans text-center" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, marginTop: "6px" }}>
                    {t({ ar: "ليس لديك حساب أو نسيت كلمة المرور؟ تواصل معنا عبر واتساب.", en: "No account or forgot your password? Contact us on WhatsApp." })}
                  </p>
                </div>
              </motion.div>
            )}

            {/* ═══ DASHBOARD ═══ */}
            {phase === "dash" && client && (
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-12">
                  <div>
                    <div className="eyebrow mb-4">{t({ ar: "بوابة العملاء", en: "Client Portal" })}</div>
                    <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.5vw,40px)", lineHeight: 1.25 }}>
                      {t({ ar: "أهلاً، ", en: "Welcome, " })}{client.full_name}
                    </h1>
                    {client.company && (
                      <p className="text-white/50" style={{ fontSize: "14px", marginTop: "6px" }}>{client.company}</p>
                    )}
                  </div>
                  <button onClick={onLogout} className="f-sans" style={{ alignSelf: "flex-start", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", background: "none", border: "1px solid rgba(255,255,255,0.15)", padding: "10px 18px", cursor: "pointer", borderRadius: "2px" }}>
                    {t({ ar: "تسجيل الخروج", en: "Sign Out" })}
                  </button>
                </div>

                {/* Projects */}
                {projects.length === 0 ? (
                  <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
                    <p className="text-white/55" style={{ fontSize: "15px" }}>
                      {t({ ar: "لا توجد مشاريع بعد — سيظهر مشروعك هنا فور تسجيله.", en: "No projects yet — your project will appear here once registered." })}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                    {projects.map((p) => <ProjectCard key={p.id} p={p} />)}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

// ─── Single project card with status timeline ───
function ProjectCard({ p }: { p: ProjectRow }) {
  const { t, isAr } = useI18n();
  const stepIndex = Math.max(0, STATUS_STEPS.findIndex((s) => s.key === p.status));
  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    isAr ? `استفسار عن مشروع: ${p.project_name}` : `Inquiry about project: ${p.project_name}`
  );
  const delivery = DELIVERY_LABELS[p.delivery_status || "pending"] || DELIVERY_LABELS.pending;
  const revision = REVISION_LABELS[p.revision_status || "none"] || REVISION_LABELS.none;

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "clamp(22px,3.5vw,34px)" }}>
      {/* Title + current status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-7">
        <h3 className="text-white" style={{ fontSize: "clamp(18px,2.6vw,24px)", fontWeight: 700, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
          {p.project_name}
        </h3>
        <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "7px 14px", borderRadius: "2px", whiteSpace: "nowrap" }}>
          {t({ ar: STATUS_STEPS[stepIndex]?.ar || "", en: STATUS_STEPS[stepIndex]?.en || "" })}
        </span>
      </div>

      {/* Timeline */}
      <div style={{ marginBottom: "26px" }}>
        <div className="flex items-center" dir="ltr" style={{ gap: "0" }}>
          {STATUS_STEPS.map((s, i) => {
            const done = i <= stepIndex;
            return (
              <div key={s.key} className="flex items-center" style={{ flex: i === STATUS_STEPS.length - 1 ? "0 0 auto" : "1 1 0%" }}>
                <div style={{
                  width: "14px", height: "14px", borderRadius: "50%", flexShrink: 0,
                  background: done ? "#E31E24" : "rgba(255,255,255,0.08)",
                  border: `2px solid ${done ? "#E31E24" : "rgba(255,255,255,0.2)"}`,
                  boxShadow: done ? "0 0 10px rgba(227,30,36,0.5)" : "none",
                  transition: "all 0.4s",
                }} />
                {i < STATUS_STEPS.length - 1 && (
                  <div style={{ height: "2px", flex: 1, background: i < stepIndex ? "#E31E24" : "rgba(255,255,255,0.1)", transition: "all 0.4s" }} />
                )}
              </div>
            );
          })}
        </div>
        {/* Step labels (desktop) */}
        <div className="hidden md:flex" dir="ltr" style={{ marginTop: "10px" }}>
          {STATUS_STEPS.map((s, i) => (
            <div key={s.key} className="f-sans" style={{
              flex: i === STATUS_STEPS.length - 1 ? "0 0 auto" : "1 1 0%",
              fontSize: "9.5px", letterSpacing: "0.5px",
              color: i <= stepIndex ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)",
              textAlign: i === STATUS_STEPS.length - 1 ? "right" : "left",
              paddingInlineEnd: "6px",
            }}>
              {t({ ar: s.ar, en: s.en })}
            </div>
          ))}
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
        <Detail label={t({ ar: "تاريخ التصوير", en: "Shooting Date" })} value={p.shooting_date || t({ ar: "لم يُحدد بعد", en: "Not set yet" })} />
        <Detail label={t({ ar: "حالة التسليم", en: "Delivery Status" })} value={t(delivery)} />
        <Detail label={t({ ar: "حالة المراجعات", en: "Revision Status" })} value={t(revision)} />
      </div>

      {p.notes && (
        <p className="text-white/55" style={{ fontSize: "13.5px", lineHeight: 1.8, marginBottom: "22px", padding: "14px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px" }}>
          {p.notes}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {p.download_url ? (
          <a href={p.download_url} target="_blank" rel="noopener noreferrer" className="btn-red" style={{ justifyContent: "center" }}>
            <span>{t({ ar: "تحميل الملفات", en: "Download Files" })}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          </a>
        ) : (
          <span className="btn-ghost" style={{ justifyContent: "center", opacity: 0.45, cursor: "default" }}>
            <span>{t({ ar: "الملفات غير جاهزة بعد", en: "Files Not Ready Yet" })}</span>
          </span>
        )}
        <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-wa" style={{ justifyContent: "center" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
          <span>{t({ ar: "تواصل مع كيان", en: "Contact Kian" })}</span>
        </a>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "14px 16px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
      <div className="text-white" style={{ fontSize: "14.5px", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function ClientPortalPage() {
  return (
    <I18nProvider>
      <Portal />
    </I18nProvider>
  );
}
