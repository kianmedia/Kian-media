"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/CaseStudiesWorkbench.tsx — المرحلة ٨: طاولة العمل الداخلية
// لدراسات الحالة (قائمة · إنشاء · إعدادات النشر · سجلّ التدقيق · تصدير).
//
// ★ ما تحرسه هذه الشاشة ★
//  ١) **لا قدرة مُدَّعاة.** كلّ زرّ هنا مشروط بقدرة عادت من الخادم
//     (cs_access). إخفاء الزرّ ليس أمانًا — الأمان في الدالّة — لكنّ إظهار
//     زرّ يرفضه الخادم دائمًا كذب على المستخدم.
//  ٢) **«بانتظار القاعدة» ≠ «لا تملك صلاحية».** حالتان بلونين ونصّين، ولا
//     تُدمَجان أبدًا. الخلط يرسل موظّفًا يبحث عن ترحيلة مطبَّقة أصلًا.
//  ٣) **«معتمَدة» ليست «ظاهرة».** عمود الظهور يقرأ is_public_now من الخادم لا
//     من الحالة النصّية، فلا يظنّ المالك أنّ شيئًا على الهواء وهو ليس كذلك.
//  ٤) **التصدير عبر الخادم.** cs_export_csv يعقّم كلّ خليّة ضدّ حقن الصيغ
//     (=,+,-,@) — لا نبني CSV في المتصفّح كي لا يوجد مسار ثانٍ بلا تعقيم.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import CaseStudyBuilder from "./CaseStudyBuilder";
import {
  csAccess, csList, csAuditList, csUpsert, csSettingsSet, csExportCsv, csPublishDue,
  CS_ACCESS_CLOSED, STATUS_AR, PERMISSION_STATUS_AR, VISIBILITY_AR, visibilityAr,
  type CsAccess, type CsListRow, type CsOutcome, type CaseStudyStatus,
} from "@/lib/portal/caseStudies";

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "4px", padding: "16px",
};
const LABEL: React.CSSProperties = {
  fontSize: "9.5px", letterSpacing: "1.4px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)",
};
const INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "3px", color: "#fff", padding: "7px 10px", fontSize: "12px", width: "100%",
};
const BTN: React.CSSProperties = {
  fontSize: "10.5px", letterSpacing: "1.2px", textTransform: "uppercase",
  color: "rgba(255,255,255,0.75)", background: "none", border: "1px solid rgba(255,255,255,0.15)",
  padding: "7px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap",
};

const STATUSES: CaseStudyStatus[] = [
  "draft", "internal_review", "legal_review", "client_permission_required",
  "client_permission_received", "approved", "scheduled", "published", "unpublished", "archived",
];

/** بانر واحد يترجم أيّ حالة فشل إلى نصّ صادق بلونها الخاصّ. */
export function CsBanner({ kind, message }: { kind: "pending" | "denied" | "error" | "ok"; message: string }) {
  const tone =
    kind === "pending" ? { c: "#e0b955", bg: "rgba(224,185,85,0.08)", b: "rgba(224,185,85,0.3)" }
    : kind === "ok" ? { c: "#5fd08a", bg: "rgba(95,208,138,0.08)", b: "rgba(95,208,138,0.3)" }
    : { c: "#ff8a8e", bg: "rgba(227,30,36,0.08)", b: "rgba(227,30,36,0.3)" };
  return (
    <div className="f-sans" style={{
      padding: "13px 15px", fontSize: "12.5px", borderRadius: "3px", lineHeight: 1.85,
      color: tone.c, background: tone.bg, border: `1px solid ${tone.b}`, marginBottom: "16px",
    }}>
      {kind === "pending"
        ? "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/case_studies_platform_RUNME.sql. لا يوجد خطأ في صلاحياتك."
        : message}
    </div>
  );
}

/** يحوّل أيّ CsOutcome فاشل إلى وسم بانر. */
export function outcomeBanner<T>(o: CsOutcome<T>): { kind: "pending" | "denied" | "error"; message: string } | null {
  if (o.state === "ok") return null;
  if (o.state === "pending_migration") return { kind: "pending", message: o.message };
  if (o.state === "denied") return { kind: "denied", message: o.message };
  return { kind: "error", message: o.message };
}

export default function CaseStudiesWorkbench() {
  const { isAr } = useI18n();

  const [access, setAccess] = useState<CsAccess>(CS_ACCESS_CLOSED);
  const [phase, setPhase] = useState<"loading" | "ready" | "blocked">("loading");
  const [banner, setBanner] = useState<{ kind: "pending" | "denied" | "error"; message: string } | null>(null);
  const [flash, setFlash] = useState("");
  const [rows, setRows] = useState<CsListRow[]>([]);
  const [status, setStatus] = useState<"" | CaseStudyStatus>("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"list" | "settings" | "audit">("list");

  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);

  const loadAccess = useCallback(async () => {
    const a = await csAccess();
    if (a.state !== "ok") {
      setBanner(outcomeBanner(a));
      setPhase("blocked");
      return null;
    }
    setAccess(a.data);
    if (!a.data.can_view) {
      setBanner({ kind: "denied", message: "لا تملك صلاحية عرض دراسات الحالة." });
      setPhase("blocked");
      return null;
    }
    setPhase("ready");
    return a.data;
  }, []);

  const loadList = useCallback(async () => {
    const r = await csList({ status: status || undefined, q: q || undefined, limit: 200 });
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setRows(r.data ?? []);
  }, [status, q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await loadAccess();
      if (!alive || !a) return;
      await loadList();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => { await loadList(); };

  const create = async () => {
    if (!newTitle.trim()) { setFlash("العنوان الداخليّ مطلوب."); return; }
    setBusy(true);
    const r = await csUpsert({ internal_title: newTitle.trim(), slug: newSlug.trim() || newTitle.trim() });
    setBusy(false);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setNewTitle(""); setNewSlug(""); setFlash("أُنشئت دراسة حالة جديدة كمسودّة.");
    await loadList();
    setOpenId(String(r.data));
  };

  const exportCsv = async () => {
    const r = await csExportCsv({ status: status || undefined });
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    const blob = new Blob(["﻿" + String(r.data ?? "")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `case-studies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadAudit = async () => {
    const r = await csAuditList({ limit: 200 });
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); setAudit([]); return; }
    setAudit(r.data ?? []);
  };

  const saveSettings = async (patch: Record<string, unknown>) => {
    setBusy(true);
    const r = await csSettingsSet(patch);
    setBusy(false);
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setFlash("حُفظت الإعدادات.");
    await loadAccess();
  };

  const normaliseDue = async () => {
    const r = await csPublishDue();
    if (r.state !== "ok") { setBanner(outcomeBanner(r)); return; }
    setFlash(`تسوية دفترية: ${r.data?.normalised ?? 0} دراسة انتقلت إلى «منشورة»، ${r.data?.failed ?? 0} تعذّرت.`);
    await loadList();
  };

  if (openId) {
    return (
      <CaseStudyBuilder
        id={openId}
        access={access}
        onBack={async () => { setOpenId(null); await loadList(); }}
      />
    );
  }

  const dir: React.CSSProperties = { direction: isAr ? "rtl" : "ltr", textAlign: isAr ? "right" : "left" };

  if (phase === "loading") {
    return <div className="f-sans" style={{ ...dir, color: "rgba(255,255,255,0.5)", fontSize: "13px" }}>…جارٍ التحميل</div>;
  }
  if (phase === "blocked") {
    return <div style={dir}>{banner && <CsBanner kind={banner.kind} message={banner.message} />}</div>;
  }

  return (
    <div style={dir}>
      {banner && <CsBanner kind={banner.kind} message={banner.message} />}
      {flash && <CsBanner kind="ok" message={flash} />}

      {/* ★ صدق السطح العامّ ★ الميزة قد تكون مطبَّقة والقسم العامّ مطفأً. */}
      {!access.public_enabled && (
        <div className="f-sans" style={{
          ...CARD, marginBottom: "16px", fontSize: "12.5px", lineHeight: 1.9,
          color: "rgba(255,255,255,0.62)", borderColor: "rgba(224,185,85,0.25)",
        }}>
          السطح العامّ <b style={{ color: "#e0b955" }}>مطفأ</b>: صفحة /case-studies تعرض «قريبًا» ولا تظهر أيّ دراسة
          مهما بلغت حالتها. المفتاح في تبويب «إعدادات النشر»، ويقلبه المالك وحده.
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap" }}>
        {([["list", "الدراسات"], ["settings", "إعدادات النشر"], ["audit", "سجلّ التدقيق"]] as const).map(([k, lbl]) => (
          <button key={k} className="f-sans"
            style={{ ...BTN, background: tab === k ? "rgba(227,30,36,0.10)" : "none", color: tab === k ? "#fff" : "rgba(255,255,255,0.55)" }}
            onClick={() => { setTab(k); if (k === "audit") void loadAudit(); }}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <>
          <div style={{ ...CARD, marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ minWidth: "200px", flex: "1 1 200px" }}>
                <div className="f-sans" style={LABEL}>بحث (عنوان داخليّ أو slug)</div>
                <input className="f-sans" style={INPUT} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div style={{ minWidth: "180px" }}>
                <div className="f-sans" style={LABEL}>الحالة</div>
                <select className="f-sans" style={INPUT} value={status} onChange={(e) => setStatus(e.target.value as CaseStudyStatus | "")}>
                  <option value="">الكلّ</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_AR[s]}</option>)}
                </select>
              </div>
              <button className="f-sans" style={BTN} onClick={refresh}>تحديث</button>
              <button className="f-sans" style={BTN} onClick={exportCsv}>تصدير CSV</button>
              {/* الخادم يشترط صلاحية المراجعة لهذه التسوية — لا الملكيّة. نطابقه
                  بدل أن نُخفيها عن مراجع يملكها فعلًا. */}
              {access.can_review && (
                <button className="f-sans" style={BTN} onClick={normaliseDue}
                  title="تحديث حالة الدراسات المجدوَلة التي حلّ موعدها — الظهور العامّ لا ينتظر هذا الزرّ">
                  تسوية المجدوَل
                </button>
              )}
            </div>
          </div>

          {access.can_edit && (
            <div style={{ ...CARD, marginBottom: "16px" }}>
              <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>دراسة حالة جديدة</div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 240px" }}>
                  <div className="f-sans" style={LABEL}>العنوان الداخليّ</div>
                  <input className="f-sans" style={INPUT} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <div className="f-sans" style={LABEL}>الـslug (اختياريّ)</div>
                  <input className="f-sans" style={INPUT} value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="riyadh-industrial-film" />
                </div>
                <button className="f-sans" style={{ ...BTN, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={create}>إنشاء مسودّة</button>
              </div>
              <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "10px", lineHeight: 1.85 }}>
                ⛔ لا يُنسخ أيّ محتوى من منصّة المشاريع تلقائيًّا. كلّ حقل عامّ يُكتَب أو يُعتمَد هنا صراحةً.
              </div>
            </div>
          )}

          <div style={{ ...CARD, padding: 0, overflowX: "auto" }}>
            <table className="f-sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", minWidth: "820px" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["الرمز", "العنوان الداخليّ", "الحالة", "الظهور", "هوية العميل", "الإذن", "النسخة", "آخر تحديث"].map((h) => (
                    <th key={h} className="f-sans" style={{ ...LABEL, padding: "10px 12px", textAlign: isAr ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="f-sans" style={{ padding: "22px 12px", color: "rgba(255,255,255,0.45)" }}>
                    لا توجد دراسات مطابقة. هذا فراغ حقيقيّ لا تعذّر قراءة.
                  </td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}
                      onClick={() => setOpenId(r.id)}
                      style={{ borderTop: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{r.code ?? "—"}</td>
                    <td style={{ padding: "10px 12px", color: "#fff" }}>
                      {r.internal_title}
                      {r.has_unapproved_changes && (
                        <span style={{ color: "#e0b955", fontSize: "10.5px", marginInlineStart: "8px" }}>• تغييرات غير معتمَدة</span>
                      )}
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "10.5px" }}>/{r.slug}</div>
                    </td>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>{STATUS_AR[r.status] ?? r.status}</td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: r.is_public_now ? "#5fd08a" : "rgba(255,255,255,0.5)" }}>
                      {visibilityAr(r)}
                    </td>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                      {VISIBILITY_AR[r.client_identity_visibility] ?? r.client_identity_visibility}
                    </td>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                      {PERMISSION_STATUS_AR[r.permission_status] ?? r.permission_status}
                    </td>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.5)" }}>v{r.current_version}</td>
                    <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>{String(r.updated_at ?? "").slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "settings" && (
        <SettingsPanel access={access} busy={busy} onSave={saveSettings} />
      )}

      {tab === "audit" && (
        <div style={{ ...CARD, padding: 0, overflowX: "auto" }}>
          <table className="f-sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", minWidth: "640px" }}>
            <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {["الإجراء", "الدراسة", "نجح", "التفاصيل", "الوقت"].map((h) => (
                <th key={h} className="f-sans" style={{ ...LABEL, padding: "10px 12px", textAlign: isAr ? "right" : "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {audit.length === 0 && (
                <tr><td colSpan={5} className="f-sans" style={{ padding: "22px 12px", color: "rgba(255,255,255,0.45)" }}>
                  لا سجلّات — أو لا تملك صلاحية المراجعة (السجلّ مقصور عليها).
                </td></tr>
              )}
              {audit.map((a, i) => (
                <tr key={String(a.id ?? i)} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "9px 12px", color: "#fff" }}>{String(a.action ?? "")}</td>
                  <td style={{ padding: "9px 12px", color: "rgba(255,255,255,0.5)", fontSize: "10.5px" }}>{String(a.case_study_id ?? "—").slice(0, 8)}</td>
                  <td style={{ padding: "9px 12px", color: a.ok === false ? "#ff8a8e" : "#5fd08a" }}>{a.ok === false ? "رُفض" : "تمّ"}</td>
                  <td style={{ padding: "9px 12px", color: "rgba(255,255,255,0.45)", fontSize: "10.5px", maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {JSON.stringify(a.details ?? {}).slice(0, 160)}
                  </td>
                  <td style={{ padding: "9px 12px", color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>{String(a.at ?? "").slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** إعدادات النشر — المالك وحده يحفظها، والخادم يعيد الرفض لغيره. */
function SettingsPanel({
  access, busy, onSave,
}: { access: CsAccess; busy: boolean; onSave: (p: Record<string, unknown>) => void }) {
  const [hosts, setHosts] = useState(access.media_allowed_hosts.join(", "));
  const [maxBytes, setMaxBytes] = useState(String(access.max_media_bytes));
  const [provider, setProvider] = useState(access.virus_scan_provider ?? "");

  const row = (label: string, value: boolean, key: string, note?: string) => (
    <div style={{ ...CARD, marginBottom: "10px" }}>
      <label className="f-sans" style={{ display: "flex", gap: "10px", alignItems: "center", cursor: access.can_publish ? "pointer" : "not-allowed", fontSize: "13px", color: "#fff" }}>
        <input type="checkbox" checked={value} disabled={!access.can_publish || busy}
               onChange={(e) => onSave({ [key]: e.target.checked ? "true" : "false" })} />
        {label}
      </label>
      {note && <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "8px", lineHeight: 1.85 }}>{note}</div>}
    </div>
  );

  return (
    <div>
      {!access.can_publish && (
        <CsBanner kind="denied" message="الإعدادات للعرض فقط — قلب مفتاح النشر العامّ قرار ملكيّة، والخادم يرفضه لغير المالك." />
      )}
      {row("تفعيل السطح العامّ (/case-studies)", access.public_enabled, "public_enabled",
        "مطفأ = الصفحة العامّة تعرض «قريبًا» ولا تُفهرَس. مفعَّل = تظهر الدراسات المنشورة وحدها.")}
      {row("اشتراط إذن العميل قبل النشر", access.require_permission_for_publish, "require_permission_for_publish",
        "إطفاؤه لا يسمح بنشر اسم أو شعار أو أرقام بلا إذن — تلك موانع منفصلة لا تُطفأ من هنا.")}
      {row("اشتراط تجريد الوسائط من بياناتها الوصفية", access.require_metadata_stripped, "require_metadata_stripped",
        "صورة بموقع GPS وتاريخ وجهاز تكشف موقع تصوير عميل. التجريد يُؤشَّر عند رفع المشتقّ.")}
      {row("اشتراط فحص الفيروسات", access.require_virus_scan, "require_virus_scan",
        access.virus_scan_provider
          ? `المزوّد المسجَّل: ${access.virus_scan_provider}`
          : "⚠️ لا مزوّد فحص مضبوط. تفعيل هذا الخيار بلا مزوّد يمنع النشر تمامًا — وهو سلوك مقصود: منع صادق خير من ادّعاء فحص لم يحدث.")}

      <div style={{ ...CARD }}>
        <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>حدود الوسائط</div>
        <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <div>
            <div className="f-sans" style={LABEL}>مضيفون مسموح بهم (مفصولون بفاصلة)</div>
            <input className="f-sans" style={INPUT} value={hosts} disabled={!access.can_publish} onChange={(e) => setHosts(e.target.value)} placeholder="cdn.example.com" />
            <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>فارغ = مسارات المستودع العامّة فقط.</div>
          </div>
          <div>
            <div className="f-sans" style={LABEL}>الحدّ الأقصى لحجم الملفّ (بايت)</div>
            <input className="f-sans" style={INPUT} value={maxBytes} disabled={!access.can_publish} onChange={(e) => setMaxBytes(e.target.value)} />
          </div>
          <div>
            <div className="f-sans" style={LABEL}>مزوّد فحص الفيروسات</div>
            <input className="f-sans" style={INPUT} value={provider} disabled={!access.can_publish} onChange={(e) => setProvider(e.target.value)} placeholder="لا يوجد" />
          </div>
        </div>
        {access.can_publish && (
          <button className="f-sans" style={{ ...BTN, marginTop: "12px", opacity: busy ? 0.5 : 1 }} disabled={busy}
            onClick={() => onSave({
              media_allowed_hosts: hosts.split(",").map((h) => h.trim()).filter(Boolean),
              max_media_bytes: maxBytes,
              virus_scan_provider: provider,
            })}>
            حفظ الحدود
          </button>
        )}
      </div>
    </div>
  );
}
