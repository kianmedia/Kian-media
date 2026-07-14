"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin/Manager Testimonials moderation (اعتدال آراء العملاء).
// owner/super_admin/manager (route-gated + RLS + civ_can_manage RPCs). Enabling
// the PUBLIC display is owner-only (civ_can_admin). List/filter, approve/reject/
// hide, feature + order, and add a testimonial manually.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  listTestimonials, testimonialsAdminSettings, setTestimonialsEnabled,
  moderateTestimonial, setTestimonialFeature, adminCreateTestimonial,
  TESTIMONIAL_STATUS_LABELS, type AdminTestimonial, type TestimonialsAdminSettings,
} from "@/lib/portal/testimonials";

const STATUS_TABS = ["pending", "approved", "rejected", "hidden", ""] as const;
const STATUS_COLOR: Record<string, string> = {
  pending: "rgba(255,196,0,0.95)", approved: "rgba(74,222,128,0.95)",
  rejected: "#ff6b6f", hidden: "rgba(255,255,255,0.4)",
};

export default function AdminTestimonials() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<AdminTestimonial[]>([]);
  const [settings, setSettings] = useState<TestimonialsAdminSettings | null>(null);
  const [tab, setTab] = useState<string>("pending");
  const [busy, setBusy] = useState<string>("");
  const [flash, setFlash] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  async function loadSettings() {
    const s = await testimonialsAdminSettings();
    if (s.ok) setSettings(s.data);
  }
  async function load() {
    setPhase("loading");
    const r = await listTestimonials(tab || undefined);
    if (!r.ok) { setPhase("error"); return; }
    setRows(r.data); setPhase("ready");
    void loadSettings();
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tab]);

  function notify(msg: string) { setFlash(msg); window.setTimeout(() => setFlash(""), 2600); }

  async function doModerate(id: string, status: string, reason?: string) {
    setBusy(id);
    const r = await moderateTestimonial(id, status, reason);
    setBusy("");
    if (!r.ok) { notify(t({ ar: "تعذّر تحديث الحالة", en: "Could not update status" })); return; }
    notify(t({ ar: "تم التحديث", en: "Updated" }));
    void load();
  }
  async function doFeature(row: AdminTestimonial, featured: boolean) {
    setBusy(row.id);
    const r = await setTestimonialFeature(row.id, featured);
    setBusy("");
    if (!r.ok) { notify(t({ ar: "تعذّر التحديث", en: "Could not update" })); return; }
    void load();
  }
  async function doOrder(row: AdminTestimonial, order: number) {
    setBusy(row.id);
    const r = await setTestimonialFeature(row.id, row.is_featured, order);
    setBusy("");
    if (!r.ok) { notify(t({ ar: "تعذّر التحديث", en: "Could not update" })); return; }
    void load();
  }
  async function toggleEnabled() {
    if (!settings) return;
    setBusy("settings");
    const r = await setTestimonialsEnabled(!settings.enabled);
    setBusy("");
    if (!r.ok) { notify(t({ ar: "تعذّر تغيير حالة العرض", en: "Could not toggle display" })); return; }
    notify(!settings.enabled ? t({ ar: "العرض العام مفعّل", en: "Public display ON" }) : t({ ar: "العرض العام متوقف", en: "Public display OFF" }));
    void loadSettings();
  }

  const card: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "6px", padding: "18px 20px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {/* Header + settings */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 className="editorial text-white" style={{ fontSize: "20px", marginBottom: "4px" }}>{t({ ar: "آراء العملاء", en: "Testimonials" })}</h2>
          {settings && (
            <p className="text-white/50" style={{ fontSize: "12.5px" }}>
              {t({ ar: "بانتظار المراجعة", en: "Pending" })}: <b style={{ color: STATUS_COLOR.pending }}>{settings.pending}</b>
              {"  ·  "}{t({ ar: "معتمدة", en: "Approved" })}: <b style={{ color: STATUS_COLOR.approved }}>{settings.approved}</b>
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowAdd((s) => !s)} className="f-sans" style={{ ...pillBtn, borderColor: "rgba(255,255,255,0.2)" }}>
            {showAdd ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "+ إضافة يدويًا", en: "+ Add manually" })}
          </button>
          {caps.isOwner && settings && (
            <button onClick={toggleEnabled} disabled={busy === "settings"} className="f-sans"
              style={{ ...pillBtn, borderColor: settings.enabled ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.2)", color: settings.enabled ? "rgba(74,222,128,0.95)" : "rgba(255,255,255,0.7)" }}>
              {settings.enabled ? t({ ar: "● العرض العام: مفعّل", en: "● Public: ON" }) : t({ ar: "○ العرض العام: متوقف", en: "○ Public: OFF" })}
            </button>
          )}
        </div>
      </div>

      {showAdd && <AddManual onDone={() => { setShowAdd(false); void load(); notify(t({ ar: "تمت الإضافة", en: "Added" })); }} />}

      {/* Status tabs */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {STATUS_TABS.map((s) => (
          <button key={s || "all"} onClick={() => setTab(s)} className="f-sans"
            style={{ ...pillBtn, background: tab === s ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.03)", borderColor: tab === s ? "rgba(227,30,36,0.45)" : "rgba(255,255,255,0.1)", color: tab === s ? "#fff" : "rgba(255,255,255,0.6)" }}>
            {s ? t(TESTIMONIAL_STATUS_LABELS[s]) : t({ ar: "الكل", en: "All" })}
          </button>
        ))}
      </div>

      {flash && <div className="text-center" style={{ fontSize: "13px", color: "rgba(74,222,128,0.95)" }}>{flash}</div>}

      {phase === "loading" && <p className="text-white/40 text-center" style={{ padding: "40px" }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "error" && <p className="text-white/50 text-center" style={{ padding: "40px" }}>{t({ ar: "تعذّر تحميل البيانات — تحقق من صلاحياتك.", en: "Could not load — check your permissions." })}</p>}
      {phase === "ready" && rows.length === 0 && <p className="text-white/40 text-center" style={{ padding: "40px" }}>{t({ ar: "لا توجد عناصر في هذه الحالة.", en: "No items in this status." })}</p>}

      {phase === "ready" && rows.map((row) => (
        <div key={row.id} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
            <div>
              <span className="text-white" style={{ fontSize: "15px", fontWeight: 600 }}>{row.client_name}</span>
              {(row.client_title || row.company) && (
                <span className="text-white/45" style={{ fontSize: "12.5px", marginInlineStart: "8px" }}>
                  {[row.client_title, row.company].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {row.rating ? <span style={{ color: "var(--red)", fontSize: "13px", letterSpacing: "2px" }}>{"★".repeat(row.rating)}</span> : null}
              <span style={{ fontSize: "11.5px", color: STATUS_COLOR[row.status], border: `1px solid ${STATUS_COLOR[row.status]}`, borderRadius: "3px", padding: "2px 8px" }}>
                {t(TESTIMONIAL_STATUS_LABELS[row.status])}
              </span>
            </div>
          </div>
          <p className="f-serif italic text-white/75" style={{ fontSize: "14.5px", lineHeight: 1.8, marginBottom: "12px" }}>“{row.body}”</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "12px" }}>
            {row.status !== "approved" && <button disabled={busy === row.id} onClick={() => doModerate(row.id, "approved")} style={actBtn("rgba(74,222,128,0.5)")}>{t({ ar: "اعتماد", en: "Approve" })}</button>}
            {row.status !== "rejected" && <button disabled={busy === row.id} onClick={() => { const reason = window.prompt(isAr ? "سبب الرفض (اختياري):" : "Reject reason (optional):") ?? undefined; doModerate(row.id, "rejected", reason); }} style={actBtn("#ff6b6f")}>{t({ ar: "رفض", en: "Reject" })}</button>}
            {row.status !== "hidden" && <button disabled={busy === row.id} onClick={() => doModerate(row.id, "hidden")} style={actBtn("rgba(255,255,255,0.25)")}>{t({ ar: "إخفاء", en: "Hide" })}</button>}
            {row.status === "approved" && (
              <>
                <button disabled={busy === row.id} onClick={() => doFeature(row, !row.is_featured)} style={actBtn(row.is_featured ? "rgba(227,30,36,0.6)" : "rgba(255,255,255,0.25)")}>
                  {row.is_featured ? t({ ar: "★ مميّزة", en: "★ Featured" }) : t({ ar: "☆ تمييز", en: "☆ Feature" })}
                </button>
                <label className="text-white/40" style={{ fontSize: "11.5px", display: "flex", alignItems: "center", gap: "5px" }}>
                  {t({ ar: "ترتيب", en: "Order" })}
                  <input type="number" defaultValue={row.display_order} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== row.display_order) void doOrder(row, v); }}
                    style={{ width: "58px", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "4px 6px", fontSize: "12px", colorScheme: "dark" }} />
                </label>
              </>
            )}
            <span className="text-white/30" style={{ fontSize: "11px", marginInlineStart: "auto" }}>{new Date(row.created_at).toLocaleDateString(isAr ? "ar" : "en")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const pillBtn: React.CSSProperties = { padding: "8px 14px", fontSize: "12.5px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.7)", cursor: "pointer" };
function actBtn(color: string): React.CSSProperties {
  return { padding: "6px 13px", fontSize: "12.5px", borderRadius: "4px", border: `1px solid ${color}`, background: "transparent", color, cursor: "pointer" };
}

function AddManual({ onDone }: { onDone: () => void }) {
  const { t, isAr } = useI18n();
  const [f, setF] = useState({ name: "", title: "", company: "", body: "" });
  const [rating, setRating] = useState(0);
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const inp: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "9px 11px", fontSize: "13.5px", colorScheme: "dark", outline: "none" };

  async function submit() {
    setErr("");
    if (f.name.trim().length < 2 || f.body.trim().length < 10) { setErr(t({ ar: "الاسم ونص التجربة مطلوبان.", en: "Name and body are required." })); return; }
    setBusy(true);
    const r = await adminCreateTestimonial({ name: f.name.trim(), body: f.body.trim(), title: f.title.trim() || undefined, company: f.company.trim() || undefined, rating: rating || null, lang: isAr ? "ar" : "en", featured });
    setBusy(false);
    if (!r.ok) { setErr(t({ ar: "تعذّرت الإضافة.", en: "Could not add." })); return; }
    onDone();
  }

  return (
    <div style={{ background: "rgba(227,30,36,0.04)", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <input placeholder={t({ ar: "الاسم *", en: "Name *" })} value={f.name} onChange={(e) => set("name", e.target.value)} style={inp} />
        <input placeholder={t({ ar: "المسمّى", en: "Title" })} value={f.title} onChange={(e) => set("title", e.target.value)} style={inp} />
      </div>
      <input placeholder={t({ ar: "الجهة / الشركة", en: "Company" })} value={f.company} onChange={(e) => set("company", e.target.value)} style={inp} />
      <textarea placeholder={t({ ar: "نص التجربة *", en: "Testimonial body *" })} value={f.body} onChange={(e) => set("body", e.target.value)} rows={4} style={{ ...inp, resize: "vertical" }} />
      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n === rating ? 0 : n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", color: n <= rating ? "#E31E24" : "rgba(255,255,255,0.2)" }}>★</button>
          ))}
        </div>
        <label className="text-white/60" style={{ fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> {t({ ar: "تمييز", en: "Feature" })}
        </label>
      </div>
      {err && <p style={{ color: "#ff6b6f", fontSize: "12.5px" }}>{err}</p>}
      <button onClick={submit} disabled={busy} className="btn-red" style={{ justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
        <span>{busy ? "..." : t({ ar: "إضافة ونشر", en: "Add & Publish" })}</span>
      </button>
    </div>
  );
}
