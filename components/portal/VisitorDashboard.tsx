"use client";
// ════════════════════════════════════════════════════════════════════════
// Visitor / lead "Project Tools" dashboard (Phase 4). Makes the lead portal
// useful: value header, requests center, rule-based brief builder, a production
// needs calculator, free resources, account-completion progress, community
// teaser. Writes via SECURITY DEFINER RPCs (lib/portal/visitor). No AI required.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  listMyBriefs, listMyPortalRequests, submitBrief, submitPortalRequest, buildBriefSummary,
  PORTAL_REQUEST_STATUS_LABELS, PORTAL_REQUEST_TYPE_LABELS,
  type ProjectBrief, type PortalRequest, type NewBriefInput,
} from "@/lib/portal/visitor";
import { listMyQuotes } from "@/lib/portal/leads";
import type { QuoteRequest } from "@/lib/portal/types";

const ACCENT = "#E31E24";

const SERVICE_OPTIONS = [
  { ar: "فيلم مؤسسي", en: "Corporate Film" },
  { ar: "تغطية فعالية", en: "Event Coverage" },
  { ar: "بث مباشر", en: "Live Streaming" },
  { ar: "تصوير عقاري", en: "Real Estate" },
  { ar: "تصوير صناعي", en: "Industrial / Factory" },
  { ar: "حفل زفاف", en: "Wedding" },
  { ar: "ريلز ومحتوى سوشيال", en: "Social Reels" },
  { ar: "تصوير بالدرون", en: "Drone Filming" },
  { ar: "أخرى", en: "Other" },
];
const BUDGET_OPTIONS = [
  { ar: "أقل من ١٠٬٠٠٠ ريال", en: "Under 10,000 SAR" },
  { ar: "١٠٬٠٠٠ - ٢٥٬٠٠٠ ريال", en: "10,000 - 25,000 SAR" },
  { ar: "٢٥٬٠٠٠ - ٥٠٬٠٠٠ ريال", en: "25,000 - 50,000 SAR" },
  { ar: "٥٠٬٠٠٠ - ١٠٠٬٠٠٠ ريال", en: "50,000 - 100,000 SAR" },
  { ar: "أكثر من ١٠٠٬٠٠٠ ريال", en: "Above 100,000 SAR" },
];
const DELIVERABLE_OPTIONS = [
  { ar: "فيلم رئيسي", en: "Hero film" },
  { ar: "ريلز قصيرة", en: "Short reels" },
  { ar: "صور احترافية", en: "Photography" },
  { ar: "لقطات درون", en: "Drone footage" },
  { ar: "بث مباشر", en: "Live stream" },
  { ar: "موشن جرافيك", en: "Motion graphics" },
];

const CALC_PRESETS = [
  { key: "corporate_event", ar: "فعالية مؤسسية", en: "Corporate event",
    crew: { ar: "مصوّر + مساعد + مخرج", en: "Shooter + assistant + director" }, cams: { ar: "كاميرتان", en: "2 cameras" },
    out: { ar: "فيلم ٣–٥ دقائق + ٣ ريلز + صور", en: "3–5 min film + 3 reels + photos" } },
  { key: "conference_live", ar: "مؤتمر / بث مباشر", en: "Conference / live streaming",
    crew: { ar: "فريق بث (٣–٤)", en: "Live crew (3–4)" }, cams: { ar: "٣ كاميرات + مازج فيديو", en: "3 cameras + video mixer" },
    out: { ar: "بث مباشر + تسجيل كامل + مقاطع", en: "Live stream + full recording + clips" } },
  { key: "real_estate", ar: "تصوير عقاري", en: "Real estate filming",
    crew: { ar: "مصوّر + طيار درون", en: "Shooter + drone pilot" }, cams: { ar: "كاميرا + درون", en: "Camera + drone" },
    out: { ar: "جولة فيديو + صور + لقطات جوية", en: "Video tour + photos + aerials" } },
  { key: "wedding", ar: "حفل زفاف", en: "Wedding",
    crew: { ar: "مصوّرا فيديو + مصوّر فوتو", en: "2 video + 1 photo" }, cams: { ar: "٢–٣ كاميرات", en: "2–3 cameras" },
    out: { ar: "فيلم زفاف + هايلايت + صور", en: "Wedding film + highlight + photos" } },
  { key: "industrial", ar: "فيلم صناعي", en: "Factory / industrial film",
    crew: { ar: "مصوّر + درون + مخرج", en: "Shooter + drone + director" }, cams: { ar: "كاميرا + درون", en: "Camera + drone" },
    out: { ar: "فيلم صناعي + لقطات عمليات وسلامة", en: "Industrial film + process/safety footage" } },
  { key: "social_reels", ar: "باقة ريلز سوشيال", en: "Social media reels package",
    crew: { ar: "مصوّر + مونتير", en: "Shooter + editor" }, cams: { ar: "كاميرا سينمائية + موبايل", en: "Cinema camera + mobile" },
    out: { ar: "٨–١٢ ريلز شهريًا", en: "8–12 reels / month" } },
];

const RESOURCES = [
  { ar: "تشيك ليست تجهيز يوم التصوير", en: "Shoot-day prep checklist" },
  { ar: "نموذج Brief لمشروع فيديو", en: "Video project brief template" },
  { ar: "دليل تجهيز البث المباشر", en: "Live streaming setup guide" },
  { ar: "دليل التصوير العقاري", en: "Real estate filming guide" },
  { ar: "دليل تغطية الفعاليات", en: "Event coverage guide" },
];

type AnyRequest =
  | { kind: "brief"; id: string; title: string; status: string; created_at: string }
  | { kind: "request"; id: string; title: string; typeLabel: string; status: string; created_at: string }
  | { kind: "quote"; id: string; title: string; status: string; created_at: string };

export default function VisitorDashboard() {
  const { t, isAr } = useI18n();
  const { profile, readOnly } = usePortal();

  const [briefs, setBriefs] = useState<ProjectBrief[]>([]);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };

  const reload = useCallback(async () => {
    const [b, r, q] = await Promise.all([listMyBriefs(), listMyPortalRequests(), listMyQuotes()]);
    if (b.ok) setBriefs(b.data);
    if (r.ok) setRequests(r.data);
    if (q.ok) setQuotes(q.data);
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // ── Brief builder state ──────────────────────────────────────────────────
  const [bf, setBf] = useState({ serviceType: "", goal: "", city: "", expectedDate: "", budgetRange: "", notes: "" });
  const [deliv, setDeliv] = useState<string[]>([]);
  const [savingBrief, setSavingBrief] = useState(false);
  const toggleDeliv = (label: string) => setDeliv((p) => p.includes(label) ? p.filter((x) => x !== label) : [...p, label]);

  async function saveBrief() {
    if (readOnly) return;
    if (!bf.serviceType || !bf.goal.trim()) { flash(t({ ar: "اختر الخدمة واكتب هدف المشروع", en: "Pick a service and describe your goal" })); return; }
    const input: NewBriefInput = {
      serviceType: bf.serviceType, goal: bf.goal, city: bf.city, expectedDate: bf.expectedDate || null,
      deliverables: deliv, budgetRange: bf.budgetRange, notes: bf.notes,
    };
    input.aiSummary = buildBriefSummary(input, isAr);
    setSavingBrief(true);
    const res = await submitBrief(input);
    setSavingBrief(false);
    if (!res.ok) { flash((isAr ? "تعذّر الحفظ: " : "Save failed: ") + res.error); return; }
    setBf({ serviceType: "", goal: "", city: "", expectedDate: "", budgetRange: "", notes: "" });
    setDeliv([]);
    await reload();
    flash(isAr ? "تم حفظ موجز مشروعك، سيتواصل فريق المبيعات قريبًا." : "Brief saved — our sales team will reach out soon.");
  }

  // ── Calculator state ─────────────────────────────────────────────────────
  const [presetKey, setPresetKey] = useState(CALC_PRESETS[0].key);
  const preset = CALC_PRESETS.find((p) => p.key === presetKey) || CALC_PRESETS[0];
  async function requestFromCalc() {
    if (readOnly) return;
    const title = isAr ? preset.ar : preset.en;
    const summary = `${t(preset.crew)} · ${t(preset.cams)} · ${t(preset.out)}`;
    const res = await submitPortalRequest({ type: "quote", title, summary, source: "calculator" });
    if (!res.ok) { flash((isAr ? "تعذّر الإرسال: " : "Failed: ") + res.error); return; }
    await reload();
    flash(isAr ? "أرسلنا تقديرك المبدئي لفريق المبيعات." : "Your estimate request was sent to sales.");
  }

  // ── Account completion ───────────────────────────────────────────────────
  const completion = useMemo(() => {
    const checks = [
      { ok: !!profile.full_name, ar: "الاسم", en: "Name" },
      { ok: !!profile.company, ar: "الشركة", en: "Company" },
      { ok: !!profile.mobile, ar: "رقم الجوال", en: "Phone" },
      { ok: briefs.length > 0, ar: "موجز مشروع", en: "A project brief" },
      { ok: quotes.length > 0 || requests.length > 0, ar: "أول طلب", en: "A first request" },
    ];
    const done = checks.filter((c) => c.ok).length;
    return { pct: Math.round((done / checks.length) * 100), checks };
  }, [profile, briefs, quotes, requests]);

  // ── Unified requests center ──────────────────────────────────────────────
  const allRequests = useMemo<AnyRequest[]>(() => {
    const out: AnyRequest[] = [];
    briefs.forEach((b) => out.push({ kind: "brief", id: b.id, title: b.service_type || (isAr ? "موجز مشروع" : "Project brief"), status: b.status, created_at: b.created_at }));
    requests.filter((r) => r.request_type !== "brief").forEach((r) =>
      out.push({ kind: "request", id: r.id, title: r.title || (isAr ? "طلب" : "Request"), typeLabel: t(PORTAL_REQUEST_TYPE_LABELS[r.request_type]), status: r.status, created_at: r.created_at }));
    quotes.forEach((q) => out.push({ kind: "quote", id: q.id, title: (q.services || []).join("، ") || (isAr ? "طلب عرض سعر" : "Quote request"), status: "new", created_at: q.created_at }));
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [briefs, requests, quotes, isAr, t]);

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "9px 11px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const card: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "18px 18px" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ display: "inline-block", fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1, textDecoration: "none" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 1) Value header */}
      <div style={{ ...card, background: "linear-gradient(135deg, rgba(227,30,36,0.14), rgba(255,255,255,0.02))" }}>
        <div className="eyebrow mb-3">{t({ ar: "بوابة كيان", en: "Kian Portal" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(22px,3.6vw,32px)", lineHeight: 1.3, margin: 0 }}>
          {t({ ar: "جهّز مشروعك الإعلامي مع كيان من أول فكرة إلى التسليم.", en: "Plan your media project with Kian from first idea to final delivery." })}
        </h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <Link href="/quote-request" style={btn(ACCENT)}>{t({ ar: "اطلب عرض سعر", en: "Request a Quote" })}</Link>
          <Link href="/book-meeting" style={btn("rgba(255,255,255,0.10)")}>{t({ ar: "احجز اجتماع", en: "Book a Consultation" })}</Link>
        </div>
      </div>

      {/* 6) Account completion */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "اكتمال الحساب", en: "Account completion" })}</strong>
          <span style={{ color: ACCENT, fontWeight: 700 }}>{completion.pct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${completion.pct}%`, height: "100%", background: ACCENT, transition: "width .4s" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {completion.checks.map((c, i) => (
            <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 99, border: `1px solid ${c.ok ? "rgba(37,211,102,0.4)" : "rgba(255,255,255,0.15)"}`, color: c.ok ? "#25D366" : "rgba(255,255,255,0.5)" }}>
              {c.ok ? "✓ " : "○ "}{t(c)}
            </span>
          ))}
        </div>
      </div>

      {/* 2) My requests center */}
      <div style={card}>
        <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "مركز طلباتي", en: "My Requests" })}</strong>
        {loading ? (
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 12 }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>
        ) : allRequests.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 12, lineHeight: 1.8 }}>
            {t({ ar: "لا توجد طلبات بعد. ابدأ بموجز مشروع أو اطلب عرض سعر.", en: "No requests yet. Start with a project brief or request a quote." })}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {allRequests.map((r) => (
              <div key={`${r.kind}-${r.id}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, fontSize: 12 }}>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(227,30,36,0.16)", color: "#ff9ea1" }}>
                  {r.kind === "brief" ? t({ ar: "موجز", en: "Brief" }) : r.kind === "quote" ? t({ ar: "عرض سعر", en: "Quote" }) : (r as Extract<AnyRequest, { kind: "request" }>).typeLabel}
                </span>
                <strong style={{ color: "#fff" }}>{r.title}</strong>
                <span style={{ marginInlineStart: "auto", color: "rgba(255,255,255,0.45)" }}>
                  {PORTAL_REQUEST_STATUS_LABELS[(r.status as keyof typeof PORTAL_REQUEST_STATUS_LABELS)]
                    ? t(PORTAL_REQUEST_STATUS_LABELS[r.status as keyof typeof PORTAL_REQUEST_STATUS_LABELS]) : r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3) Smart brief builder */}
      <div style={card}>
        <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "مُنشئ موجز المشروع الذكي", en: "Smart Project Brief Builder" })}</strong>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, margin: "6px 0 14px" }}>
          {t({ ar: "أخبرنا عن مشروعك بدقائق وسنجهّز لك تصورًا مبدئيًا.", en: "Tell us about your project in a minute and we'll prep a first outline." })}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "نوع الخدمة", en: "Service" })}</span>
            <select value={bf.serviceType} onChange={(e) => setBf({ ...bf, serviceType: e.target.value })} style={inp}>
              <option value="">—</option>
              {SERVICE_OPTIONS.map((s, i) => <option key={i} value={t(s)}>{t(s)}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "المدينة", en: "City" })}</span>
            <input value={bf.city} onChange={(e) => setBf({ ...bf, city: e.target.value })} style={inp} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "التاريخ المتوقع", en: "Expected date" })}</span>
            <input type="date" value={bf.expectedDate} onChange={(e) => setBf({ ...bf, expectedDate: e.target.value })} style={inp} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "الميزانية (اختياري)", en: "Budget (optional)" })}</span>
            <select value={bf.budgetRange} onChange={(e) => setBf({ ...bf, budgetRange: e.target.value })} style={inp}>
              <option value="">—</option>
              {BUDGET_OPTIONS.map((b, i) => <option key={i} value={t(b)}>{t(b)}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "هدف المشروع", en: "Project goal" })}</span>
          <textarea value={bf.goal} onChange={(e) => setBf({ ...bf, goal: e.target.value })} rows={2} style={{ ...inp, marginTop: 4, resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <div style={{ marginTop: 12 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "المخرجات المطلوبة", en: "Deliverables" })}</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
            {DELIVERABLE_OPTIONS.map((d, i) => {
              const label = t(d); const on = deliv.includes(label);
              return <button key={i} onClick={() => toggleDeliv(label)} style={{ fontSize: 12, padding: "5px 11px", borderRadius: 99, cursor: "pointer", border: `1px solid ${on ? ACCENT : "rgba(255,255,255,0.15)"}`, background: on ? "rgba(227,30,36,0.18)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,0.6)" }}>{label}</button>;
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, alignItems: "center" }}>
          <button onClick={() => void saveBrief()} disabled={savingBrief || readOnly} style={btn(ACCENT, savingBrief || readOnly)}>
            {savingBrief ? "…" : t({ ar: "احفظ الموجز", en: "Save brief" })}
          </button>
          <Link href="/quote-request" style={btn("rgba(255,255,255,0.10)")}>{t({ ar: "اطلب عرض سعر رسمي", en: "Request an official quote" })}</Link>
          <Link href="/book-meeting" style={btn("rgba(255,255,255,0.10)")}>{t({ ar: "احجز اجتماع مع كيان", en: "Book a meeting" })}</Link>
        </div>
      </div>

      {/* 4) Production needs calculator */}
      <div style={card}>
        <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "حاسبة احتياجات الإنتاج", en: "Production Needs Calculator" })}</strong>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "12px 0" }}>
          {CALC_PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPresetKey(p.key)} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 99, cursor: "pointer", border: `1px solid ${p.key === presetKey ? ACCENT : "rgba(255,255,255,0.15)"}`, background: p.key === presetKey ? "rgba(227,30,36,0.18)" : "transparent", color: p.key === presetKey ? "#fff" : "rgba(255,255,255,0.6)" }}>{t(p)}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {[{ l: { ar: "الطاقم المقترح", en: "Suggested crew" }, v: preset.crew }, { l: { ar: "الكاميرات", en: "Cameras" }, v: preset.cams }, { l: { ar: "المخرجات", en: "Deliverables" }, v: preset.out }].map((x, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "11px 12px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 4 }}>{t(x.l)}</div>
              <div style={{ fontSize: 13, color: "#fff", lineHeight: 1.6 }}>{t(x.v)}</div>
            </div>
          ))}
        </div>
        <button onClick={() => void requestFromCalc()} disabled={readOnly} style={{ ...btn(ACCENT, readOnly), marginTop: 14 }}>
          {t({ ar: "اطلب عرض سعر بهذه المواصفات", en: "Request a quote with this setup" })}
        </button>
      </div>

      {/* 5) Free resources */}
      <div style={card}>
        <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "موارد مجانية", en: "Free Resources" })}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 12 }}>
          {RESOURCES.map((r, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "13px 13px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#fff", lineHeight: 1.5 }}>{t(r)}</span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>{t({ ar: "قريبًا", en: "Soon" })}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 7) Community teaser */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong style={{ color: "#fff", fontSize: 14 }}>{t({ ar: "من مجتمع كيان للمبدعين", en: "From Kian Creators Community" })}</strong>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, margin: "6px 0 0" }}>
            {t({ ar: "مساحة قادمة لمشاركة الخبرات والأسئلة بين صنّاع المحتوى.", en: "A space — coming soon — to share experience and questions among creators." })}
          </p>
        </div>
        <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 99, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.55)" }}>{t({ ar: "قريبًا", en: "Coming soon" })}</span>
      </div>

      {toast && (
        <div style={{ position: "fixed", insetInlineEnd: 20, bottom: 20, background: "rgba(0,0,0,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#fff", zIndex: 50, maxWidth: 360 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
