"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/CaseStudyBuilder.tsx — المرحلة ٨: محرّر دراسة الحالة.
//
// ★ خمس قواعد مكتوبة في هذا الملفّ لا في التعليقات وحدها ★
//  ١) **لا نشر من هنا.** أزرار النشر/الجدولة/السحب تظهر للمالك فقط، والخادم
//     يرفضها لغيره حتّى لو ظهرت. المحرّر يرى مساره: «أرسل للمراجعة» ثمّ يقف.
//  ٢) **الموانع من الخادم.** لا نحسب في المتصفّح ما يمنع النشر؛ نعرض ما قاله
//     cs_publish_blockers حرفيًّا. أيّ حساب محلّيّ كان سيصنع فجوة بين ما تُظهره
//     الشاشة وما يرفضه الخادم.
//  ٣) **التفريغ فعل صريح.** الخادم يتجاهل النصّ الفارغ (كلّ إسناد coalesce)،
//     فحقل أُفرغ هنا يُرسَل في مصفوفة clear. بلا هذا يبقى نصّ كُتب خطأً عالقًا.
//  ٤) **لا تعديل صامت بعد النشر.** أوّل تحرير بعد النشر يشترط ملخّص تغيير،
//     والشاشة تطلبه قبل الإرسال بدل أن تُفاجئ المحرّر برفض من القاعدة.
//  ٥) **لا رابط معاينة.** المعاينة نداء JSON داخل الجلسة. لا رمز، ولا رابط
//     يُرسَل لعميل، ولا مسار تخزين يظهر في أيّ مكان من هذه الشاشة.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CsBanner, outcomeBanner } from "./CaseStudiesWorkbench";
import {
  csGet, csUpsert, csSetTaxonomy, csLookups, csChecklist, csPreview, csVersions, csRollback,
  csMediaUpsert, csMediaDelete, csMetricUpsert, csMetricDelete, csCreditUpsert, csCreditDelete,
  csPermissionSet, csSubmit, csReviewDecide, csLegalDecide, csPermissionConfirm, csApprove,
  csPublish, csSchedule, csUnpublish, csArchive, csRestore,
  blockerAr, hardBlockers, warnings, STATUS_AR, PERMISSION_STATUS_AR, VISIBILITY_AR, MEDIA_KIND_AR,
  type CsAccess, type CsDetail, type CsChecklist, type CsVersionRow, type CsLookups,
  type CsMediaRow, type CsMetricRow, type CsCreditRow, type CaseStudyStatus, type MediaKind,
} from "@/lib/portal/caseStudies";

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "4px", padding: "16px", marginBottom: "14px",
};
const LABEL: React.CSSProperties = {
  fontSize: "9.5px", letterSpacing: "1.4px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)",
};
const INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "3px", color: "#fff", padding: "7px 10px", fontSize: "12px", width: "100%",
};
const AREA: React.CSSProperties = { ...INPUT, minHeight: "92px", lineHeight: 1.8, resize: "vertical" };
const BTN: React.CSSProperties = {
  fontSize: "10.5px", letterSpacing: "1.2px", textTransform: "uppercase",
  color: "rgba(255,255,255,0.75)", background: "none", border: "1px solid rgba(255,255,255,0.15)",
  padding: "7px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap",
};
const BTN_RED: React.CSSProperties = { ...BTN, color: "#ff8a8e", borderColor: "rgba(227,30,36,0.35)" };
const NOTE: React.CSSProperties = { fontSize: "11.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.9 };

/** أزواج المحتوى ثنائيّ اللغة، بترتيب السرد التحريريّ. */
const PAIRS: { key: string; ar: string; long?: boolean }[] = [
  { key: "public_title", ar: "العنوان العامّ" },
  { key: "summary", ar: "الملخّص", long: true },
  { key: "challenge", ar: "التحدّي", long: true },
  { key: "objectives", ar: "الأهداف", long: true },
  { key: "creative_approach", ar: "المعالجة الإبداعية", long: true },
  { key: "production_approach", ar: "المعالجة الإنتاجية", long: true },
  { key: "operational_complexity", ar: "التعقيد التشغيليّ", long: true },
  { key: "equipment_summary", ar: "ملخّص المعدّات", long: true },
  { key: "safety_compliance", ar: "السلامة والامتثال", long: true },
  { key: "timeline_summary", ar: "الجدول الزمنيّ", long: true },
  { key: "deliverables_summary", ar: "ملخّص المخرجات", long: true },
  { key: "challenges_faced", ar: "تحدّيات واجهتنا", long: true },
  { key: "solution", ar: "كيف عالجها فريق كيان", long: true },
  { key: "results", ar: "النتائج", long: true },
  { key: "seo_title", ar: "عنوان SEO" },
  { key: "seo_description", ar: "وصف SEO", long: true },
  { key: "og_title", ar: "عنوان المشاركة (OG)" },
  { key: "og_description", ar: "وصف المشاركة (OG)", long: true },
];

/** الحقول التي يقبل الخادم محوها صراحةً (مصفوفة clear في cs_upsert). */
const CLEARABLE = new Set<string>([
  "internal_notes", "project_reference_note", "client_display_name", "client_slug",
  "anonymized_label_ar", "anonymized_label_en", "crew_size_min", "crew_size_max",
  "project_start", "project_end", "testimonial_ar", "testimonial_en",
  "testimonial_author", "testimonial_author_title", "canonical_path",
  ...PAIRS.flatMap((p) => [`${p.key}_ar`, `${p.key}_en`]),
]);

const SINGLES: { key: string; ar: string; type?: "date" | "number" | "textarea" }[] = [
  { key: "internal_title", ar: "العنوان الداخليّ" },
  { key: "slug", ar: "الـslug العامّ" },
  { key: "internal_notes", ar: "ملاحظات داخلية", type: "textarea" },
  { key: "client_display_name", ar: "اسم العميل (لا يظهر إلّا بإذن صريح)" },
  { key: "client_slug", ar: "معرّف العميل في lib/clients.ts" },
  { key: "anonymized_label_ar", ar: "التسمية المجهَّلة (عربي)" },
  { key: "anonymized_label_en", ar: "التسمية المجهَّلة (إنجليزي)" },
  { key: "crew_size_min", ar: "أقلّ عدد للفريق", type: "number" },
  { key: "crew_size_max", ar: "أكبر عدد للفريق", type: "number" },
  { key: "project_start", ar: "بداية العمل", type: "date" },
  { key: "project_end", ar: "نهاية العمل", type: "date" },
  { key: "testimonial_ar", ar: "شهادة العميل (عربي)", type: "textarea" },
  { key: "testimonial_en", ar: "شهادة العميل (إنجليزي)", type: "textarea" },
  { key: "testimonial_author", ar: "قائل الشهادة" },
  { key: "testimonial_author_title", ar: "صفة قائل الشهادة" },
  { key: "canonical_path", ar: "المسار الكنسيّ" },
  { key: "project_reference_note", ar: "ملاحظة مرجع المشروع (داخليّ)" },
];

const CHECK_AR: Record<string, string> = {
  permission_status: "حالة الإذن", permission_reference: "مرجع الإذن موثَّق",
  permitted_project_name: "إذن باستعمال اسم المشروع/العميل", permitted_logo: "إذن باستعمال الشعار",
  permitted_metrics: "إذن بنشر الأرقام", permitted_testimonial: "إذن بنشر الشهادة",
  permission_expires_at: "الإذن ساري المفعول",
  identity_visibility: "طريقة عرض هوية العميل", anonymization_required: "الإذن لا يشترط التجهيل",
  embargo_until: "لا حظر نشر ساري", restrictions_recorded: "قيود السرّية مسجَّلة",
  no_project_data_copied: "لا نسخ تلقائيّ من منصّة المشاريع", employee_consent: "موافقة الموظّفين على ذكر أسمائهم",
};

type Vals = Record<string, string>;

const asStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};

export default function CaseStudyBuilder({
  id, access, onBack,
}: { id: string; access: CsAccess; onBack: () => void }) {
  const { isAr } = useI18n();

  const [detail, setDetail] = useState<CsDetail | null>(null);
  const [lookups, setLookups] = useState<CsLookups | null>(null);
  const [banner, setBanner] = useState<{ kind: "pending" | "denied" | "error"; message: string } | null>(null);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"content" | "media" | "outcomes" | "permission" | "readiness" | "preview" | "versions" | "workflow">("content");

  const [vals, setVals] = useState<Vals>({});
  const [orig, setOrig] = useState<Vals>({});
  const [featured, setFeatured] = useState(false);
  const [sortOrder, setSortOrder] = useState("100");
  const [visibility, setVisibility] = useState("hidden");
  const [locations, setLocations] = useState("");
  const [sectors, setSectors] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [changeSummary, setChangeSummary] = useState("");

  const [checklist, setChecklist] = useState<CsChecklist | null>(null);
  const [versions, setVersions] = useState<CsVersionRow[]>([]);
  const [preview, setPreview] = useState<{ is_public_now: boolean; projection: unknown } | null>(null);

  const study = (detail?.study ?? {}) as Record<string, unknown>;
  const status = asStr(study.status) as CaseStudyStatus;
  const published = !!study.published_version_id;
  const archived = study.archived === true;

  const load = useCallback(async () => {
    const r = await csGet(id);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    const d = r.data;
    setDetail(d);
    const s = d.study as Record<string, unknown>;
    const next: Vals = {};
    for (const p of PAIRS) { next[`${p.key}_ar`] = asStr(s[`${p.key}_ar`]); next[`${p.key}_en`] = asStr(s[`${p.key}_en`]); }
    for (const f of SINGLES) next[f.key] = asStr(s[f.key]).slice(0, 10_000);
    next.project_start = asStr(s.project_start).slice(0, 10);
    next.project_end = asStr(s.project_end).slice(0, 10);
    setVals(next); setOrig(next);
    setFeatured(s.featured === true);
    setSortOrder(asStr(s.sort_order) || "100");
    setVisibility(asStr(s.client_identity_visibility) || "hidden");
    setLocations(Array.isArray(s.locations) ? (s.locations as string[]).join("، ") : "");
    setSectors(d.sectors ?? []); setServices(d.services ?? []);
    setChangeSummary("");
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      const l = await csLookups();
      if (alive && l.state === "ok") setLookups(l.data);
    })();
    return () => { alive = false; };
  }, [load]);

  const loadChecklist = useCallback(async () => {
    const r = await csChecklist(id);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setChecklist(r.data);
  }, [id]);

  const loadVersions = useCallback(async () => {
    const r = await csVersions(id);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setVersions(r.data ?? []);
  }, [id]);

  const loadPreview = useCallback(async () => {
    const r = await csPreview(id);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setPreview({ is_public_now: r.data.is_public_now, projection: r.data.projection });
  }, [id]);

  useEffect(() => {
    if (tab === "readiness" || tab === "workflow") void loadChecklist();
    if (tab === "versions") void loadVersions();
    if (tab === "preview") void loadPreview();
  }, [tab, loadChecklist, loadVersions, loadPreview]);

  const dirty = useMemo(() => {
    const s = detail?.study as Record<string, unknown> | undefined;
    if (!s) return false;
    if (Object.keys(vals).some((k) => vals[k] !== orig[k])) return true;
    if (featured !== (s.featured === true)) return true;
    if (sortOrder !== (asStr(s.sort_order) || "100")) return true;
    if (visibility !== (asStr(s.client_identity_visibility) || "hidden")) return true;
    const locOrig = Array.isArray(s.locations) ? (s.locations as string[]).join("، ") : "";
    if (locations !== locOrig) return true;
    if (JSON.stringify(sectors) !== JSON.stringify(detail?.sectors ?? [])) return true;
    if (JSON.stringify(services) !== JSON.stringify(detail?.services ?? [])) return true;
    return false;
  }, [vals, orig, featured, sortOrder, visibility, locations, sectors, services, detail]);

  const run = async (
    fn: () => Promise<{ state: string; message?: string; blockers?: unknown }>,
    okMsg: string,
  ) => {
    setBusy(true); setBanner(null);
    const r = (await fn()) as { state: string; message?: string };
    setBusy(false);
    if (r.state === "ok") {
      setFlash(okMsg);
      await load();
      if (tab === "readiness" || tab === "workflow") await loadChecklist();
      if (tab === "versions") await loadVersions();
      return true;
    }
    if (r.state === "blocked") { setBanner({ kind: "error", message: r.message ?? "" }); return false; }
    setBanner(outcomeBanner(r as never));
    return false;
  };

  const save = async () => {
    const payload: Record<string, unknown> = { id };
    const clear: string[] = [];
    for (const k of Object.keys(vals)) {
      const cur = vals[k].trim(); const was = (orig[k] ?? "").trim();
      if (cur === was) continue;
      if (cur === "") { if (CLEARABLE.has(k)) clear.push(k); continue; }
      payload[k] = cur;
    }
    payload.featured = featured ? "true" : "false";
    payload.sort_order = sortOrder;
    payload.client_identity_visibility = visibility;
    payload.locations = locations.split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    if (clear.length > 0) payload.clear = clear;
    if (published) {
      if (changeSummary.trim().length < 8) {
        setBanner({ kind: "error", message: "تحرير دراسة منشورة يشترط ملخّص تغيير لا يقلّ عن ٨ محارف — لا تعديل صامت بعد النشر." });
        return;
      }
      payload.change_summary = changeSummary.trim();
    }
    const ok = await run(() => csUpsert(payload), clear.length ? `حُفظ التحرير، ومُحيت ${clear.length} حقلًا.` : "حُفظ التحرير.");
    if (!ok) return;
    if (JSON.stringify(sectors) !== JSON.stringify(detail?.sectors ?? []) ||
        JSON.stringify(services) !== JSON.stringify(detail?.services ?? [])) {
      await run(() => csSetTaxonomy(id, sectors, services), "حُدِّث التصنيف.");
    }
  };

  const dir: React.CSSProperties = { direction: isAr ? "rtl" : "ltr", textAlign: isAr ? "right" : "left" };

  if (!detail) {
    return (
      <div style={dir}>
        <button className="f-sans" style={{ ...BTN, marginBottom: "14px" }} onClick={onBack}>رجوع</button>
        {banner ? <CsBanner kind={banner.kind} message={banner.message} /> : <div className="f-sans" style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px" }}>…جارٍ التحميل</div>}
      </div>
    );
  }

  const canEdit = access.can_edit && !archived;

  return (
    <div style={dir}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px" }}>
        <button className="f-sans" style={BTN} onClick={onBack}>رجوع إلى القائمة</button>
        <div className="f-sans" style={{ color: "#fff", fontSize: "14px" }}>
          {asStr(study.code)} — {asStr(study.internal_title)}
        </div>
        <div className="f-sans" style={{ ...LABEL, color: detail.is_public_now ? "#5fd08a" : "rgba(255,255,255,0.45)" }}>
          {STATUS_AR[status] ?? status} · {detail.is_public_now ? "ظاهرة للعامّة الآن" : "غير ظاهرة"} · v{asStr(study.current_version)}
        </div>
      </div>

      {banner && <CsBanner kind={banner.kind} message={banner.message} />}
      {flash && <CsBanner kind="ok" message={flash} />}
      {archived && <CsBanner kind="pending" message="هذه الدراسة مؤرشفة — التحرير مغلق حتّى تُستعاد." />}

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {([
          ["content", "المحتوى"], ["media", "الوسائط"], ["outcomes", "النتائج والاعتمادات"],
          ["permission", "إذن العميل"], ["readiness", "الجاهزية والموانع"], ["preview", "المعاينة"],
          ["versions", "النسخ"], ["workflow", "المسار التحريريّ"],
        ] as const).map(([k, lbl]) => (
          <button key={k} className="f-sans"
            style={{ ...BTN, background: tab === k ? "rgba(227,30,36,0.10)" : "none", color: tab === k ? "#fff" : "rgba(255,255,255,0.55)" }}
            onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {/* ─── المحتوى ─────────────────────────────────────────────────────── */}
      {tab === "content" && (
        <>
          <div style={CARD}>
            <div className="f-sans" style={{ ...LABEL, marginBottom: "12px" }}>الهوية والنشر</div>
            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
              {SINGLES.map((f) => (
                <div key={f.key} style={{ gridColumn: f.type === "textarea" ? "1 / -1" : undefined }}>
                  <div className="f-sans" style={LABEL}>{f.ar}</div>
                  {f.type === "textarea" ? (
                    <textarea className="f-sans" style={AREA} disabled={!canEdit} value={vals[f.key] ?? ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                  ) : (
                    <input className="f-sans" style={INPUT} disabled={!canEdit}
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                      value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                  )}
                </div>
              ))}
              <div>
                <div className="f-sans" style={LABEL}>عرض هوية العميل</div>
                <select className="f-sans" style={INPUT} disabled={!canEdit} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  {(["named", "anonymized", "hidden"] as const).map((v) => <option key={v} value={v}>{VISIBILITY_AR[v]}</option>)}
                </select>
              </div>
              <div>
                <div className="f-sans" style={LABEL}>مواقع التصوير (مفصولة بفاصلة)</div>
                <input className="f-sans" style={INPUT} disabled={!canEdit} value={locations} onChange={(e) => setLocations(e.target.value)} />
              </div>
              <div>
                <div className="f-sans" style={LABEL}>ترتيب العرض</div>
                <input className="f-sans" style={INPUT} disabled={!canEdit} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <label className="f-sans" style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12.5px", color: "#fff" }}>
                  <input type="checkbox" disabled={!canEdit} checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
                  مميّزة في الفهرس العامّ
                </label>
              </div>
            </div>
            <div className="f-sans" style={{ ...NOTE, marginTop: "12px" }}>
              التجهيل المعتمَد: اختر «مجهَّل» واكتب تسمية مثل «جهة صناعية كبرى في المملكة». القاعدة ترفض التجهيل بلا تسمية.
              {" "}⛔ حقل «معرّف المشروع» مرجع داخليّ للقراءة فقط ولا يظهر في أيّ مخرَج عامّ، ولا يُنسَخ منه محتوى تلقائيًّا.
            </div>
          </div>

          {lookups && (
            <div style={CARD}>
              <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>القطاعات والخدمات (فلاتر الصفحة العامّة)</div>
              <TaxonomyPicker title="القطاعات" all={lookups.sectors} chosen={sectors} disabled={!canEdit} onChange={setSectors} />
              <div style={{ height: "12px" }} />
              <TaxonomyPicker title="الخدمات" all={lookups.services} chosen={services} disabled={!canEdit} onChange={setServices} />
            </div>
          )}

          <div style={CARD}>
            <div className="f-sans" style={{ ...LABEL, marginBottom: "12px" }}>المحتوى العربيّ والإنجليزيّ — جنبًا إلى جنب</div>
            {PAIRS.map((p) => {
              const arV = vals[`${p.key}_ar`] ?? ""; const enV = vals[`${p.key}_en`] ?? "";
              const gap = (arV.trim() === "") !== (enV.trim() === "");
              return (
                <div key={p.key} style={{ marginBottom: "16px" }}>
                  <div className="f-sans" style={{ ...LABEL, color: gap ? "#e0b955" : LABEL.color, marginBottom: "6px" }}>
                    {p.ar}{gap ? " — لغة ناقصة" : ""}
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                    {p.long ? (
                      <>
                        <textarea className="f-sans" style={AREA} dir="rtl" placeholder="عربي" disabled={!canEdit}
                          value={arV} onChange={(e) => setVals({ ...vals, [`${p.key}_ar`]: e.target.value })} />
                        <textarea className="f-sans" style={AREA} dir="ltr" placeholder="English" disabled={!canEdit}
                          value={enV} onChange={(e) => setVals({ ...vals, [`${p.key}_en`]: e.target.value })} />
                      </>
                    ) : (
                      <>
                        <input className="f-sans" style={INPUT} dir="rtl" placeholder="عربي" disabled={!canEdit}
                          value={arV} onChange={(e) => setVals({ ...vals, [`${p.key}_ar`]: e.target.value })} />
                        <input className="f-sans" style={INPUT} dir="ltr" placeholder="English" disabled={!canEdit}
                          value={enV} onChange={(e) => setVals({ ...vals, [`${p.key}_en`]: e.target.value })} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div style={CARD}>
              {published && (
                <div style={{ marginBottom: "12px" }}>
                  <div className="f-sans" style={LABEL}>ملخّص التغيير (مطلوب — الدراسة منشورة)</div>
                  <input className="f-sans" style={INPUT} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)}
                    placeholder="مثال: تصحيح رقم النتائج بعد اعتماد العميل" />
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button className="f-sans" style={{ ...BTN, opacity: busy || !dirty ? 0.5 : 1 }} disabled={busy || !dirty} onClick={save}>
                  حفظ التحرير
                </button>
                <button className="f-sans" style={BTN} disabled={busy} onClick={() => void load()}>تراجع عن التغييرات غير المحفوظة</button>
                <span className="f-sans" style={NOTE}>
                  {dirty ? "توجد تغييرات غير محفوظة." : "لا تغييرات غير محفوظة."}
                  {" "}إفراغ حقل هنا يعني محوه فعلًا (يُرسَل في مصفوفة clear) — الخادم يتجاهل الفراغ العابر.
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── الوسائط ─────────────────────────────────────────────────────── */}
      {tab === "media" && (
        <MediaTab id={id} rows={detail.media} canEdit={canEdit} access={access} busy={busy}
          onDone={async (m) => { setFlash(m); await load(); }} onFail={(b) => setBanner(b)} />
      )}

      {/* ─── النتائج والاعتمادات ─────────────────────────────────────────── */}
      {tab === "outcomes" && (
        <OutcomesTab id={id} metrics={detail.metrics} credits={detail.credits} access={access} canEdit={canEdit}
          onDone={async (m) => { setFlash(m); await load(); }} onFail={(b) => setBanner(b)} />
      )}

      {/* ─── الإذن ───────────────────────────────────────────────────────── */}
      {tab === "permission" && (
        <PermissionTab id={id} detail={detail} access={access}
          onDone={async (m) => { setFlash(m); await load(); }} onFail={(b) => setBanner(b)} />
      )}

      {/* ─── الجاهزية ────────────────────────────────────────────────────── */}
      {tab === "readiness" && <ReadinessTab checklist={checklist} onRefresh={loadChecklist} />}

      {/* ─── المعاينة ────────────────────────────────────────────────────── */}
      {tab === "preview" && <PreviewTab preview={preview} onRefresh={loadPreview} />}

      {/* ─── النسخ ───────────────────────────────────────────────────────── */}
      {tab === "versions" && (
        <VersionsTab versions={versions} canEdit={canEdit} busy={busy}
          onRollback={async (n, s) => { await run(() => csRollback(id, n, s), `أُنشئت نسخة جديدة من الرجوع إلى v${n}.`); await loadVersions(); }} />
      )}

      {/* ─── المسار ──────────────────────────────────────────────────────── */}
      {tab === "workflow" && (
        <WorkflowTab
          status={status} archived={archived} access={access} checklist={checklist} busy={busy}
          onAction={run} id={id} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function TaxonomyPicker({
  title, all, chosen, disabled, onChange,
}: {
  title: string; disabled: boolean; chosen: string[];
  all: { slug: string; name_ar: string; active: boolean }[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <div className="f-sans" style={{ ...LABEL, marginBottom: "8px" }}>{title}</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {all.length === 0 && <span className="f-sans" style={NOTE}>لا كتالوج بعد.</span>}
        {all.filter((x) => x.active || chosen.includes(x.slug)).map((x) => {
          const on = chosen.includes(x.slug);
          return (
            <button key={x.slug} className="f-sans" disabled={disabled}
              style={{ ...BTN, background: on ? "rgba(227,30,36,0.12)" : "none", color: on ? "#fff" : "rgba(255,255,255,0.5)" }}
              onClick={() => onChange(on ? chosen.filter((c) => c !== x.slug) : [...chosen, x.slug])}>
              {x.name_ar}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function MediaTab({
  id, rows, canEdit, access, busy, onDone, onFail,
}: {
  id: string; rows: CsMediaRow[]; canEdit: boolean; access: CsAccess; busy: boolean;
  onDone: (m: string) => void; onFail: (b: { kind: "pending" | "denied" | "error"; message: string }) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({ asset_kind: "hero", sort_order: "100" });
  const [working, setWorking] = useState(false);

  const submit = async (payload: Record<string, unknown>, msg: string) => {
    setWorking(true);
    const r = await csMediaUpsert({ case_study_id: id, ...payload });
    setWorking(false);
    if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
    onDone(msg);
  };

  const remove = async (mid: string) => {
    const reason = window.prompt("سبب الحذف (يُسجَّل في التدقيق):") ?? "";
    if (!reason.trim()) return;
    const r = await csMediaDelete(mid, reason.trim());
    if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
    onDone("حُذف عنصر الوسائط.");
  };

  return (
    <>
      <div style={{ ...CARD, borderColor: "rgba(224,185,85,0.25)" }}>
        <div className="f-sans" style={{ ...NOTE, color: "rgba(255,255,255,0.62)" }}>
          <b style={{ color: "#e0b955" }}>عقد الوسائط العامّة</b> — مشتقّات معتمَدة فقط: لا ملفّات كاميرا أصلية، ولا معاينة داخلية
          موسومة، ولا مخرَج عميل خاصّ، ولا رابط موقَّع. القاعدة ترفض أيّ رابط يشير إلى دلو خاصّ أو يحمل token.
          الحدّ الأقصى للحجم {(access.max_media_bytes / 1_000_000).toFixed(1)} ميغابايت.
          {access.require_virus_scan && !access.virus_scan_provider &&
            " ⚠️ الفحص مشترط بلا مزوّد — النشر ممنوع حتّى يُضبَط أو يُطفأ الاشتراط."}
        </div>
      </div>

      {canEdit && (
        <div style={CARD}>
          <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>إضافة عنصر</div>
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div>
              <div className="f-sans" style={LABEL}>النوع</div>
              <select className="f-sans" style={INPUT} value={draft.asset_kind} onChange={(e) => setDraft({ ...draft, asset_kind: e.target.value })}>
                {(Object.keys(MEDIA_KIND_AR) as MediaKind[]).map((k) => <option key={k} value={k}>{MEDIA_KIND_AR[k]}</option>)}
              </select>
            </div>
            {[["public_url", "رابط المشتقّ العامّ"], ["video_provider", "مزوّد الفيديو (youtube/vimeo)"], ["video_id", "معرّف الفيديو"],
              ["alt_ar", "نصّ بديل (عربي)"], ["alt_en", "نصّ بديل (إنجليزي)"], ["caption_ar", "تعليق (عربي)"], ["caption_en", "تعليق (إنجليزي)"],
              ["pair_key", "مفتاح الاقتران (قبل/بعد)"], ["bytes", "الحجم بالبايت"], ["content_type", "نوع المحتوى"],
              ["safe_filename", "اسم ملفّ آمن"], ["sort_order", "الترتيب"]].map(([k, lbl]) => (
              <div key={k}>
                <div className="f-sans" style={LABEL}>{lbl}</div>
                <input className="f-sans" style={INPUT} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
              <label className="f-sans" style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "#fff" }}>
                <input type="checkbox" checked={draft.metadata_stripped === "true"}
                  onChange={(e) => setDraft({ ...draft, metadata_stripped: e.target.checked ? "true" : "false" })} />
                جُرِّدت البيانات الوصفية
              </label>
            </div>
          </div>
          <button className="f-sans" style={{ ...BTN, marginTop: "12px", opacity: working || busy ? 0.5 : 1 }} disabled={working || busy}
            onClick={() => submit(draft, "أُضيف عنصر وسائط.")}>إضافة</button>
        </div>
      )}

      {rows.length === 0 && <div style={CARD}><span className="f-sans" style={NOTE}>لا وسائط بعد. النشر يشترط صورة رئيسية بنصّ بديل بلغتين.</span></div>}

      {rows.map((m) => (
        <div key={m.id} style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <div className="f-sans" style={{ color: "#fff", fontSize: "13px" }}>
              {MEDIA_KIND_AR[m.asset_kind] ?? m.asset_kind}
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", marginInlineStart: "10px" }}>#{m.sort_order}</span>
            </div>
            <div className="f-sans" style={{ fontSize: "11px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ color: m.metadata_stripped ? "#5fd08a" : "#e0b955" }}>
                {m.metadata_stripped ? "بيانات وصفية مجرَّدة" : "بيانات وصفية غير مجرَّدة"}
              </span>
              <span style={{ color: m.virus_scan_status === "clean" ? "#5fd08a" : m.virus_scan_status === "infected" ? "#ff8a8e" : "rgba(255,255,255,0.5)" }}>
                فحص: {m.virus_scan_status}
              </span>
              {(!m.alt_ar || !m.alt_en) && <span style={{ color: "#e0b955" }}>نصّ بديل ناقص</span>}
            </div>
          </div>
          <div className="f-sans" style={{ ...NOTE, marginTop: "8px", wordBreak: "break-all" }}>
            {m.public_url ? m.public_url : m.video_provider ? `${m.video_provider}:${m.video_id ?? "—"}` : "بلا مصدر"}
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
              <button className="f-sans" style={BTN} disabled={working}
                onClick={() => submit({ id: m.id, metadata_stripped: m.metadata_stripped ? "false" : "true", asset_kind: m.asset_kind }, "حُدِّث وسم البيانات الوصفية.")}>
                {m.metadata_stripped ? "إلغاء وسم التجريد" : "وسم كمجرَّد"}
              </button>
              <button className="f-sans" style={BTN} disabled={working}
                onClick={() => {
                  const alt_ar = window.prompt("نصّ بديل عربي:", m.alt_ar ?? "") ?? "";
                  const alt_en = window.prompt("نصّ بديل إنجليزي:", m.alt_en ?? "") ?? "";
                  if (!alt_ar.trim() && !alt_en.trim()) return;
                  void submit({ id: m.id, asset_kind: m.asset_kind, alt_ar, alt_en }, "حُدِّث النصّ البديل.");
                }}>تحرير النصّ البديل</button>
              <button className="f-sans" style={BTN_RED} disabled={working} onClick={() => void remove(m.id)}>حذف</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function OutcomesTab({
  id, metrics, credits, access, canEdit, onDone, onFail,
}: {
  id: string; metrics: CsMetricRow[]; credits: CsCreditRow[]; access: CsAccess; canEdit: boolean;
  onDone: (m: string) => void; onFail: (b: { kind: "pending" | "denied" | "error"; message: string }) => void;
}) {
  const [m, setM] = useState<Record<string, string>>({});
  const [c, setC] = useState<Record<string, string>>({});

  const addMetric = async () => {
    const r = await csMetricUpsert({ case_study_id: id, ...m });
    if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
    setM({}); onDone("أُضيفت نتيجة.");
  };
  const addCredit = async () => {
    const r = await csCreditUpsert({ case_study_id: id, ...c });
    if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
    setC({}); onDone("أُضيف اعتماد.");
  };

  return (
    <>
      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>النتائج المُقاسة</div>
        <div className="f-sans" style={{ ...NOTE, marginBottom: "12px" }}>
          رقم غير معتمَد **لا يُنشَر**، ورقم معتمَد لا يُنشَر إن لم يأذن العميل بنشر الأرقام. الاعتماد فعل مراجعة لا فعل تحرير،
          والخادم يرفضه من محرّر. ⛔ ولا تُنشَر تكلفة ولا هامش بأيّ حال.
        </div>
        {metrics.length === 0 && <div className="f-sans" style={NOTE}>لا نتائج مسجَّلة.</div>}
        {metrics.map((x) => (
          <div key={x.id} style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
            <div className="f-sans" style={{ color: "#fff", fontSize: "12.5px" }}>
              {x.label_ar || x.label_en || "—"}: <b>{x.value_text}</b> {x.unit_ar ?? ""}
              <span style={{ color: x.approved ? "#5fd08a" : "#e0b955", fontSize: "11px", marginInlineStart: "10px" }}>
                {x.approved ? "معتمَد" : "غير معتمَد — لن يُنشَر"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {access.can_review && (
                <button className="f-sans" style={BTN} onClick={async () => {
                  const r = await csMetricUpsert({ case_study_id: id, id: x.id, approved: x.approved ? "false" : "true" });
                  if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
                  onDone(x.approved ? "سُحب الاعتماد." : "اعتُمدت النتيجة.");
                }}>{x.approved ? "سحب الاعتماد" : "اعتماد"}</button>
              )}
              {canEdit && (
                <button className="f-sans" style={BTN_RED} onClick={async () => {
                  const reason = window.prompt("سبب الحذف:") ?? "";
                  if (!reason.trim()) return;
                  const r = await csMetricDelete(x.id, reason.trim());
                  if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
                  onDone("حُذفت النتيجة.");
                }}>حذف</button>
              )}
            </div>
          </div>
        ))}
        {canEdit && (
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: "12px" }}>
            {[["label_ar", "التسمية (عربي)"], ["label_en", "التسمية (إنجليزي)"], ["value_text", "القيمة"], ["unit_ar", "الوحدة (عربي)"], ["source_note", "مصدر الرقم"]].map(([k, lbl]) => (
              <div key={k}>
                <div className="f-sans" style={LABEL}>{lbl}</div>
                <input className="f-sans" style={INPUT} value={m[k] ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="f-sans" style={BTN} onClick={addMetric}>إضافة نتيجة</button>
            </div>
          </div>
        )}
      </div>

      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>الاعتمادات (طاقم العمل)</div>
        <div className="f-sans" style={{ ...NOTE, marginBottom: "12px" }}>
          اسم موظّف لا يُنشَر بلا موافقة موثَّقة بمرجع (بريد/نموذج/عقد). الصندوق وحده ليس موافقة، والخادم يرفض تأشيرها من محرّر.
          الأسماء بلا موافقة تُحذَف من المخرَج العامّ صامتةً — وهذا سلوك مقصود لا عطل.
        </div>
        {credits.length === 0 && <div className="f-sans" style={NOTE}>لا اعتمادات مسجَّلة.</div>}
        {credits.map((k) => (
          <div key={k.id} style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
            <div className="f-sans" style={{ color: "#fff", fontSize: "12.5px" }}>
              {k.person_display_name} — {k.role_ar || k.role_en || "—"}
              <span style={{ color: k.consent_public ? "#5fd08a" : "#e0b955", fontSize: "11px", marginInlineStart: "10px" }}>
                {k.consent_public ? "موافقة موثَّقة" : k.is_employee ? "بلا موافقة — لن يظهر" : "بلا موافقة"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {access.can_review && !k.consent_public && (
                <button className="f-sans" style={BTN} onClick={async () => {
                  const ref = window.prompt("مرجع الموافقة الموثَّق (بريد/نموذج/عقد):") ?? "";
                  if (!ref.trim()) return;
                  const r = await csCreditUpsert({ case_study_id: id, id: k.id, consent_public: "true", consent_reference: ref.trim() });
                  if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
                  onDone("سُجّلت الموافقة بمرجعها.");
                }}>تسجيل موافقة</button>
              )}
              {canEdit && (
                <button className="f-sans" style={BTN_RED} onClick={async () => {
                  const reason = window.prompt("سبب الحذف:") ?? "";
                  if (!reason.trim()) return;
                  const r = await csCreditDelete(k.id, reason.trim());
                  if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
                  onDone("حُذف الاعتماد.");
                }}>حذف</button>
              )}
            </div>
          </div>
        ))}
        {canEdit && (
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: "12px" }}>
            {[["person_display_name", "الاسم كما يُعرَض"], ["role_ar", "الدور (عربي)"], ["role_en", "الدور (إنجليزي)"]].map(([k, lbl]) => (
              <div key={k}>
                <div className="f-sans" style={LABEL}>{lbl}</div>
                <input className="f-sans" style={INPUT} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <label className="f-sans" style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "#fff" }}>
                <input type="checkbox" checked={c.is_employee === "true"} onChange={(e) => setC({ ...c, is_employee: e.target.checked ? "true" : "false" })} />
                موظّف في كيان
              </label>
              <button className="f-sans" style={BTN} onClick={addCredit}>إضافة اعتماد</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function PermissionTab({
  id, detail, access, onDone, onFail,
}: {
  id: string; detail: CsDetail; access: CsAccess;
  onDone: (m: string) => void; onFail: (b: { kind: "pending" | "denied" | "error"; message: string }) => void;
}) {
  const p = detail.permission;
  const [form, setForm] = useState<Record<string, string>>({});

  if (!p) {
    const s = detail.permission_summary;
    return (
      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>إذن العميل — ملخّص فقط</div>
        <div className="f-sans" style={{ ...NOTE, marginBottom: "12px" }}>
          مرجع الإذن واسم جهة الاتّصال وقيود السرّية بيانات قانونية أضيق من رؤية الوحدة: لا تظهر إلّا لصلاحية المراجعة.
          ما تراه أدناه ملخّص القرارات لا مستنداتها.
        </div>
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.75)", lineHeight: 2 }}>
          الحالة: {PERMISSION_STATUS_AR[(s?.permission_status ?? "not_requested") as keyof typeof PERMISSION_STATUS_AR] ?? "—"}<br />
          اسم/شعار/أرقام/شهادة: {[s?.permitted_project_name, s?.permitted_logo, s?.permitted_metrics, s?.permitted_testimonial].map((x) => (x ? "نعم" : "لا")).join(" · ")}<br />
          التجهيل مشترط: {s?.anonymization_required ? "نعم" : "لا"}
        </div>
      </div>
    );
  }

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  const cur = (k: keyof typeof p): string => {
    const v = form[k as string];
    if (v !== undefined) return v;
    const raw = p[k];
    return raw === null || raw === undefined ? "" : String(raw);
  };
  const bool = (k: keyof typeof p): boolean => {
    const v = form[k as string];
    if (v !== undefined) return v === "true";
    return p[k] === true;
  };

  const save = async () => {
    const r = await csPermissionSet(id, form);
    if (r.state !== "ok") { onFail(outcomeBanner(r) as never); return; }
    setForm({}); onDone("سُجّل الإذن.");
  };

  return (
    <div style={CARD}>
      <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>إذن العميل — سجلّ قانونيّ</div>
      <div className="f-sans" style={{ ...NOTE, marginBottom: "14px" }}>
        هذه الحقول تفتح النشر ولا تُنفّذه. مربّع مؤشَّر بلا مرجع موثَّق ليس إذنًا — والنشر يبقى ممنوعًا ما لم تكن الحالة «ممنوح»
        وسارية، وما لم يأذن كلّ عنصر بعينه (اسم/شعار/أرقام/شهادة).
      </div>
      <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <div>
          <div className="f-sans" style={LABEL}>حالة الإذن</div>
          <select className="f-sans" style={INPUT} value={cur("permission_status")} onChange={(e) => set("permission_status", e.target.value)}>
            {Object.keys(PERMISSION_STATUS_AR).map((k) => (
              <option key={k} value={k}>{PERMISSION_STATUS_AR[k as keyof typeof PERMISSION_STATUS_AR]}</option>
            ))}
          </select>
        </div>
        {[["permission_reference", "مرجع الإذن"], ["permission_contact_name", "جهة الاتّصال"],
          ["permission_document_note", "ملاحظة المستند"], ["confidentiality_restrictions", "قيود السرّية"]].map(([k, lbl]) => (
          <div key={k}>
            <div className="f-sans" style={LABEL}>{lbl}</div>
            <input className="f-sans" style={INPUT} value={cur(k as keyof typeof p)} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        {[["permission_granted_at", "تاريخ المنح"], ["permission_expires_at", "انتهاء الإذن"], ["embargo_until", "حظر النشر حتّى"]].map(([k, lbl]) => (
          <div key={k}>
            <div className="f-sans" style={LABEL}>{lbl}</div>
            <input className="f-sans" style={INPUT} type="date" value={cur(k as keyof typeof p).slice(0, 10)} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", marginTop: "14px" }}>
        {[["permitted_project_name", "إذن باسم المشروع/العميل"], ["permitted_logo", "إذن بالشعار"],
          ["permitted_metrics", "إذن بالأرقام"], ["permitted_testimonial", "إذن بالشهادة"],
          ["anonymization_required", "التجهيل مشترط"]].map(([k, lbl]) => (
          <label key={k} className="f-sans" style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12.5px", color: "#fff" }}>
            <input type="checkbox" checked={bool(k as keyof typeof p)} onChange={(e) => set(k, e.target.checked ? "true" : "false")} />
            {lbl}
          </label>
        ))}
      </div>
      {access.can_review && (
        <button className="f-sans" style={{ ...BTN, marginTop: "14px" }} onClick={save}>حفظ سجلّ الإذن</button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function ReadinessTab({ checklist, onRefresh }: { checklist: CsChecklist | null; onRefresh: () => void }) {
  if (!checklist) return <div style={CARD}><span className="f-sans" style={NOTE}>…جارٍ حساب الجاهزية</span></div>;
  const co = checklist.completeness;
  const hard = hardBlockers(checklist.blockers);
  const warn = warnings(checklist.blockers);

  const line = (x: { key: string; ok?: boolean; value?: unknown; note?: string; suppressed?: number }) => (
    <div key={x.key} className="f-sans" style={{ display: "flex", gap: "10px", padding: "7px 0", borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: "12.5px", flexWrap: "wrap" }}>
      <span style={{ color: x.ok === undefined ? "rgba(255,255,255,0.6)" : x.ok ? "#5fd08a" : "#e0b955", minWidth: "18px" }}>
        {x.ok === undefined ? "•" : x.ok ? "✓" : "✗"}
      </span>
      <span style={{ color: "rgba(255,255,255,0.8)" }}>{CHECK_AR[x.key] ?? x.key}</span>
      {x.value !== undefined && x.value !== null && (
        <span style={{ color: "rgba(255,255,255,0.45)" }}>— {String(x.value)}</span>
      )}
      {typeof x.suppressed === "number" && x.suppressed > 0 && (
        <span style={{ color: "#e0b955" }}>— {x.suppressed} اسمًا لن يظهر</span>
      )}
      {x.note && <span style={{ color: "rgba(255,255,255,0.4)" }}>— {x.note}</span>}
    </div>
  );

  return (
    <>
      <div style={CARD}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div className="f-sans" style={LABEL}>اكتمال اللغتين</div>
          <button className="f-sans" style={BTN} onClick={onRefresh}>إعادة الفحص</button>
        </div>
        <div className="f-sans" style={{ color: "#fff", fontSize: "13px", margin: "10px 0" }}>
          العربية {co.ar_pct}% ({co.ar_filled}/{co.total_fields}) · الإنجليزية {co.en_pct}% ({co.en_filled}/{co.total_fields})
        </div>
        <div style={{ display: "grid", gap: "4px", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {co.fields.map((f) => (
            <div key={f.field} className="f-sans" style={{ fontSize: "11.5px", color: f.ar && f.en ? "rgba(255,255,255,0.5)" : "#e0b955" }}>
              {PAIRS.find((p) => p.key === f.field)?.ar ?? f.field}: {f.ar ? "ع" : "—"} / {f.en ? "EN" : "—"}
            </div>
          ))}
        </div>
      </div>

      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>معاينة SEO</div>
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.75)", lineHeight: 2 }}>
          {Object.entries(checklist.seo_preview).map(([k, v]) => (
            <div key={k}><span style={{ color: "rgba(255,255,255,0.4)" }}>{k}:</span> {v ? String(v) : "— (سيُشتقّ تلقائيًّا)"}</div>
          ))}
        </div>
      </div>

      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "6px" }}>قائمة الإذن</div>
        {checklist.permission_checklist.map(line)}
      </div>

      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "6px" }}>قائمة السرّية</div>
        {checklist.confidentiality_checklist.map(line)}
      </div>

      <div style={{ ...CARD, borderColor: hard.length ? "rgba(227,30,36,0.3)" : "rgba(95,208,138,0.25)" }}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>موانع النشر (من الخادم)</div>
        {hard.length === 0
          ? <div className="f-sans" style={{ color: "#5fd08a", fontSize: "12.5px" }}>لا موانع صلبة. النشر النهائيّ يبقى قرار المالك.</div>
          : hard.map((b, i) => (
            <div key={`${b.code}-${i}`} className="f-sans" style={{ color: "#ff8a8e", fontSize: "12.5px", padding: "5px 0" }}>
              ✗ {blockerAr(b.code)}{b.count ? ` (${b.count})` : ""}
            </div>
          ))}
        {warn.map((b, i) => (
          <div key={`w-${b.code}-${i}`} className="f-sans" style={{ color: "#e0b955", fontSize: "12.5px", padding: "5px 0" }}>
            ⚠ {blockerAr(b.code)}{b.detail_ar ? ` — ${b.detail_ar}` : ""}
          </div>
        ))}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function PreviewTab({ preview, onRefresh }: { preview: { is_public_now: boolean; projection: unknown } | null; onRefresh: () => void }) {
  const proj = (preview?.projection ?? {}) as Record<string, unknown>;
  const body = (proj.body ?? {}) as Record<string, unknown>;
  const media = Array.isArray(proj.media) ? (proj.media as Record<string, unknown>[]) : [];
  const metrics = Array.isArray(proj.metrics) ? (proj.metrics as Record<string, unknown>[]) : [];
  const credits = Array.isArray(proj.credits) ? (proj.credits as Record<string, unknown>[]) : [];

  return (
    <>
      <div style={{ ...CARD, borderColor: "rgba(224,185,85,0.25)" }}>
        <div className="f-sans" style={{ ...NOTE, color: "rgba(255,255,255,0.62)" }}>
          هذه <b style={{ color: "#e0b955" }}>بالضبط</b> الحقول التي سيراها العامّ، مبنيّة من المحتوى الحيّ وبنفس دالّة التقنيع
          على الخادم. ما حُذف هنا محذوف هناك. ⛔ لا رابط لهذه المعاينة: لا رمز ولا صفحة عامّة — من لا يملك جلسة داخلية لا يراها.
          {preview && !preview.is_public_now && " الدراسة غير ظاهرة للعامّة الآن."}
        </div>
        <button className="f-sans" style={{ ...BTN, marginTop: "10px" }} onClick={onRefresh}>تحديث المعاينة</button>
      </div>
      <div style={CARD}>
        <div className="f-sans" style={{ color: "#fff", fontSize: "16px", marginBottom: "6px" }}>{String(proj.title_ar ?? "— بلا عنوان عربيّ")}</div>
        <div className="f-sans" style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px", marginBottom: "10px" }} dir="ltr">{String(proj.title_en ?? "— no English title")}</div>
        <div className="f-sans" style={{ color: "rgba(255,255,255,0.7)", fontSize: "12.5px", lineHeight: 2 }}>
          العميل كما سيظهر: <b>{String(proj.client_label_ar ?? "— لا ذكر للعميل")}</b><br />
          {String(proj.summary_ar ?? "")}
        </div>
      </div>
      {Object.keys(body).length > 0 && (
        <div style={CARD}>
          <div className="f-sans" style={{ ...LABEL, marginBottom: "8px" }}>أقسام المتن التي ستظهر</div>
          <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", lineHeight: 2 }}>
            {Object.keys(body).filter((k) => body[k]).join(" · ") || "لا شيء"}
          </div>
        </div>
      )}
      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "8px" }}>ما سيُنشَر فعلًا</div>
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.7)", lineHeight: 2 }}>
          وسائط: {media.length} · نتائج معتمَدة ومأذونة: {metrics.length} · أسماء بموافقة: {credits.length} ·
          شهادة: {proj.testimonial ? "نعم" : "لا"}
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function VersionsTab({
  versions, canEdit, busy, onRollback,
}: { versions: CsVersionRow[]; canEdit: boolean; busy: boolean; onRollback: (n: number, s: string) => void }) {
  return (
    <div style={CARD}>
      <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>النسخ</div>
      <div className="f-sans" style={{ ...NOTE, marginBottom: "14px" }}>
        الرجوع إلى نسخة <b>يُنشئ نسخة جديدة</b> تحمل محتواها القديم — ولا يحذف تاريخًا ولا يعيد النشر تلقائيًّا.
        النسخة المعتمَدة والنسخة المنشورة مؤشَّرتان صراحةً كي لا يُظنّ أنّ آخر تحرير هو ما على الهواء.
      </div>
      {versions.length === 0 && <div className="f-sans" style={NOTE}>لا نسخ بعد — تُنشَأ عند الإرسال للمراجعة.</div>}
      {versions.map((v) => (
        <div key={v.id} style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "12px", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="f-sans" style={{ fontSize: "12.5px", color: "#fff" }}>
            v{v.version_number}
            {v.is_published && <span style={{ color: "#5fd08a", marginInlineStart: "8px", fontSize: "11px" }}>منشورة</span>}
            {v.is_approved && !v.is_published && <span style={{ color: "#e0b955", marginInlineStart: "8px", fontSize: "11px" }}>معتمَدة</span>}
            {v.rolled_back_from != null && <span style={{ color: "rgba(255,255,255,0.45)", marginInlineStart: "8px", fontSize: "11px" }}>رجوع من v{v.rolled_back_from}</span>}
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11.5px", marginTop: "4px" }}>{v.change_summary}</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "10.5px" }}>{String(v.created_at ?? "").slice(0, 16).replace("T", " ")}</div>
          </div>
          {canEdit && (
            <button className="f-sans" style={{ ...BTN, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => {
              const s = window.prompt(`سبب الرجوع إلى v${v.version_number} (٨ محارف فأكثر):`) ?? "";
              if (s.trim().length < 8) return;
              onRollback(v.version_number, s.trim());
            }}>رجوع إلى هذه النسخة</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function WorkflowTab({
  id, status, archived, access, checklist, busy, onAction,
}: {
  id: string; status: CaseStudyStatus; archived: boolean; access: CsAccess;
  checklist: CsChecklist | null; busy: boolean;
  onAction: (fn: () => Promise<{ state: string; message?: string }>, ok: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const hard = hardBlockers(checklist?.blockers);

  const ask = (msg: string, min = 1): string | null => {
    const v = (note.trim() || window.prompt(msg) || "").trim();
    return v.length >= min ? v : null;
  };

  const Action = ({ label, onClick, danger, hint }: { label: string; onClick: () => void; danger?: boolean; hint?: string }) => (
    <div style={{ marginBottom: "10px" }}>
      <button className="f-sans" style={{ ...(danger ? BTN_RED : BTN), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={onClick}>{label}</button>
      {hint && <div className="f-sans" style={{ ...NOTE, marginTop: "6px" }}>{hint}</div>}
    </div>
  );

  return (
    <>
      <div style={CARD}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>الحالة الحالية: {STATUS_AR[status] ?? status}</div>
        <div className="f-sans" style={{ ...NOTE, marginBottom: "12px" }}>
          المسار: مسودّة ← مراجعة داخلية ← مراجعة قانونية ← إذن العميل ← اعتماد ← <b>نشر (المالك وحده)</b>.
          التسويق لا يتخطّى المراجعة القانونية ولا بوّابة الإذن، والخادم يرفض كلّ قفزة حتّى لو ظهر زرّها.
        </div>
        <div style={{ marginBottom: "12px" }}>
          <div className="f-sans" style={LABEL}>ملاحظة/سبب (تُسجَّل في التدقيق)</div>
          <input className="f-sans" style={INPUT} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {archived ? (
          access.can_publish ? (
            <Action label="استعادة من الأرشيف" onClick={() => void onAction(() => csRestore(id, ask("سبب الاستعادة:") ?? ""), "استُعيدت الدراسة كمسودّة.")} />
          ) : <div className="f-sans" style={NOTE}>مؤرشفة — الاستعادة للمالك.</div>
        ) : (
          <>
            {access.can_edit && ["draft", "unpublished"].includes(status) && (
              <Action label="إرسال للمراجعة الداخلية" hint="يُنشئ نسخة جديدة بملخّص التغيير — لا إرسال بلا ملخّص."
                onClick={() => {
                  const s = ask("ملخّص التغيير (٨ محارف فأكثر):", 8);
                  if (!s) { window.alert("ملخّص التغيير مطلوب (٨ محارف فأكثر)."); return; }
                  void onAction(() => csSubmit(id, s), "أُرسلت للمراجعة الداخلية.");
                }} />
            )}
            {access.can_review && status === "internal_review" && (
              <>
                <Action label="تمرير إلى المراجعة القانونية" onClick={() => void onAction(() => csReviewDecide(id, "advance", note), "انتقلت إلى المراجعة القانونية.")} />
                <Action label="إعادة إلى المحرّر" danger onClick={() => void onAction(() => csReviewDecide(id, "return", note), "أُعيدت إلى المسودّة.")} />
              </>
            )}
            {access.can_review && status === "legal_review" && (
              <>
                <Action label="اعتماد قانونيّ مباشر"
                  hint="ينتقل إلى «معتمَدة» — ويُرفَض إن بقي أيّ مانع إذن. أي أنّه لا يصحّ إلّا لدراسة لا تنشر عن العميل شيئًا يحتاج إذنًا."
                  onClick={() => void onAction(() => csLegalDecide(id, "approve", note), "تمّ الاعتماد القانونيّ.")} />
                <Action label="تحتاج إذن عميل" hint="المسار الصحيح لأيّ دراسة تذكر اسم العميل أو شعاره أو أرقامه أو شهادته."
                  onClick={() => void onAction(() => csLegalDecide(id, "need_permission", note), "انتقلت إلى انتظار إذن العميل.")} />
                <Action label="إعادة إلى المحرّر" danger onClick={() => void onAction(() => csLegalDecide(id, "return", note), "أُعيدت إلى المسودّة.")} />
              </>
            )}
            {access.can_review && status === "client_permission_required" && (
              <Action label="تأكيد استلام إذن العميل" hint="يشترط أن يكون سجلّ الإذن «ممنوح» بمرجع موثَّق."
                onClick={() => void onAction(() => csPermissionConfirm(id, note), "سُجّل استلام الإذن.")} />
            )}
            {access.can_review && ["client_permission_received", "unpublished"].includes(status) && (
              <Action label="اعتماد النسخة" hint="الاعتماد يثبّت النسخة المعتمَدة — ولا ينشرها."
                onClick={() => void onAction(() => csApprove(id, note), "اعتُمدت النسخة.")} />
            )}

            {access.can_publish ? (
              <>
                {["approved", "scheduled", "unpublished"].includes(status) && (
                  <Action label="نشر الآن" hint={hard.length ? `${hard.length} مانعًا صلبًا سيرفض النشر — راجع تبويب الجاهزية.` : "لا موانع صلبة مسجَّلة في آخر فحص."}
                    onClick={() => void onAction(() => csPublish(id, note), "نُشرت الدراسة.")} />
                )}
                {["approved", "scheduled", "published"].includes(status) && (
                  <div style={{ marginBottom: "10px" }}>
                    <div className="f-sans" style={LABEL}>جدولة النشر</div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "6px" }}>
                      <input className="f-sans" style={{ ...INPUT, width: "auto" }} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                      <button className="f-sans" style={BTN} disabled={busy || !when}
                        onClick={() => void onAction(() => csSchedule(id, new Date(when).toISOString(), note), "جُدولت الدراسة.")}>جدولة</button>
                    </div>
                    <div className="f-sans" style={{ ...NOTE, marginTop: "6px" }}>
                      ⚠️ المجدوَلة تصير عامّة من تلقاء نفسها لحظة بلوغ الموعد — لا تنتظر cron ولا تعتمد عليه.
                    </div>
                  </div>
                )}
                {["published", "scheduled"].includes(status) && (
                  <Action label="سحب من النشر" danger onClick={() => {
                    const s = ask("سبب السحب:"); if (!s) return;
                    void onAction(() => csUnpublish(id, s), "سُحبت من النشر.");
                  }} />
                )}
                <Action label="أرشفة" danger hint="الأرشفة تُخفي الدراسة عن العامّ وتغلق التحرير — ولا تحذف نسخة ولا سجلّ تدقيق."
                  onClick={() => { const s = ask("سبب الأرشفة:"); if (!s) return; void onAction(() => csArchive(id, s), "أُرشفت الدراسة."); }} />
              </>
            ) : (
              <div className="f-sans" style={{ ...NOTE, color: "rgba(255,255,255,0.6)", marginTop: "10px" }}>
                النشر والجدولة والسحب والأرشفة قرارات ملكيّة — لا تظهر لك ولن يقبلها الخادم منك. أوصِل الدراسة إلى «معتمَدة» وأبلغ المالك.
              </div>
            )}
          </>
        )}
      </div>

      {checklist && hard.length > 0 && (
        <div style={{ ...CARD, borderColor: "rgba(227,30,36,0.3)" }}>
          <div className="f-sans" style={{ ...LABEL, marginBottom: "8px" }}>موانع صلبة قائمة</div>
          {hard.map((b, i) => (
            <div key={`${b.code}-${i}`} className="f-sans" style={{ color: "#ff8a8e", fontSize: "12.5px", padding: "4px 0" }}>✗ {blockerAr(b.code)}</div>
          ))}
        </div>
      )}
    </>
  );
}
