"use client";
// ════════════════════════════════════════════════════════════════════════════
// وثائق الامتثال + الجاهزية.
//
// ★ ثلاث حقائق تُعرَض حرفيًّا ولا تُجمَّل ★
//   ١) «مرفوعة» ليست «صالحة». الحالة تُعرَض بنصّها، ومعها تلميح يقول إنّ الرفع
//      وحده لا يُحتسب في الجاهزية ولا يُشارَك.
//   ٢) زرّ التوثيق يظهر لمن يملك بوّابة التوثيق، ويختفي عن رافع الوثيقة نفسه —
//      والخادم يرفضه بقيد جدوليّ حتّى لو ظهر بالخطأ.
//   ٣) الوثيقة المقيَّدة لا تصل إلى المتصفّح أصلًا لغير المخوَّل. لذلك حين
//      يكون scope مقيَّدًا نقول ذلك صراحةً بدل عرض قائمة قصيرة تُقرأ «هذا كلّ
//      ما لدينا».
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  complianceDocumentDecide, complianceDocumentRegister, complianceDocumentSetStatus,
  complianceDocumentStorageRef, complianceReadiness, complianceScan, complianceSign,
  complianceUpload, buildCompanyStoragePath, documentList,
  DOC_STATUS_AR, DOC_STATUS_HINT_AR, SENSITIVITY_AR, READINESS_STATE_AR, VERDICT_AR,
  type ComplianceDocument, type DocumentListResult, type ReadinessResult,
  type DocStatus, type Sensitivity, type VccAccess,
} from "@/lib/portal/compliance";
import {
  Badge, Btn, CC, Card, EmptyState, Field, OutcomeView, fmtDate,
} from "./ComplianceAtoms";

type Panel<T> = { s: "load" } | { s: "ok"; d: T } | { s: "bad"; view: JSX.Element };

const toneFor = (st: DocStatus): "good" | "warn" | "bad" | "dim" =>
  st === "verified" ? "good"
    : st === "expired" || st === "revoked" || st === "rejected" ? "bad"
    : st === "uploaded" || st === "pending_verification" ? "warn"
    : "dim";

export default function ComplianceDocumentsPanel({ access, myUserId }: { access: VccAccess; myUserId: string | null }) {
  const [docs, setDocs] = useState<Panel<DocumentListResult>>({ s: "load" });
  const [ready, setReady] = useState<Panel<ReadinessResult>>({ s: "load" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<JSX.Element | string>("");
  const [form, setForm] = useState({ doc_type: "", title: "", issuer: "", doc_language: "ar",
    doc_number_masked: "", issued_on: "", expires_on: "", sensitivity: "internal" as Sensitivity });
  const [file, setFile] = useState<File | null>(null);

  const loadDocs = useCallback(async () => {
    const r = await documentList({});
    if (r.state === "ok") setDocs({ s: "ok", d: r.data });
    else setDocs({ s: "bad", view: <OutcomeView state={r.state} message={r.message} what="قائمة الوثائق" /> });
  }, []);

  const loadReady = useCallback(async () => {
    const r = await complianceReadiness("general");
    if (r.state === "ok") setReady({ s: "ok", d: r.data });
    else setReady({ s: "bad", view: <OutcomeView state={r.state} message={r.message} what="محرّك الجاهزية" /> });
  }, []);

  useEffect(() => { void loadDocs(); void loadReady(); }, [loadDocs, loadReady]);

  const register = useCallback(async () => {
    if (!form.doc_type.trim()) { setNotice("اختر نوع الوثيقة."); return; }
    setBusy(true); setNotice("");
    let storagePath: string | null = null;
    if (file) {
      const path = buildCompanyStoragePath(file.name);
      const up = await complianceUpload(path, file);
      if (!up.ok) {
        setBusy(false);
        // ⚠️ فشل الرفع ليس فشل تسجيل. نقولها كما هي بدل «تعذّر الحفظ».
        setNotice(`تعذّر رفع الملفّ إلى التخزين (${up.error}). لم يُسجَّل شيء.`);
        return;
      }
      storagePath = path;
    }
    const r = await complianceDocumentRegister({
      ...form,
      storage_path: storagePath,
      file_name: file?.name ?? null,
      file_mime: file?.type ?? null,
      file_bytes: file ? String(file.size) : null,
    });
    setBusy(false);
    if (r.state !== "ok") {
      setNotice(<OutcomeView state={r.state} message={r.message} what="تسجيل وثيقة" />);
      return;
    }
    setNotice(r.data.note_ar);
    setFile(null);
    setForm({ ...form, title: "", doc_number_masked: "", issued_on: "", expires_on: "" });
    await loadDocs(); await loadReady();
  }, [form, file, loadDocs, loadReady]);

  const decide = useCallback(async (id: string, decision: "verified" | "rejected") => {
    const note = window.prompt(decision === "verified"
      ? "ملاحظة التوثيق (إلزامية — ما الذي تحقّقت منه؟)"
      : "سبب الرفض (إلزاميّ)");
    if (note === null) return;
    setBusy(true);
    const r = await complianceDocumentDecide(id, decision, note);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="التوثيق" />); return; }
    setNotice(decision === "verified" ? "وُثِّقت الوثيقة." : "رُفضت الوثيقة مع سبب مسجَّل.");
    await loadDocs(); await loadReady();
  }, [loadDocs, loadReady]);

  const setStatus = useCallback(async (id: string, status: "archived" | "revoked") => {
    const reason = window.prompt(status === "revoked" ? "سبب الإلغاء (إلزاميّ)" : "سبب الأرشفة (إلزاميّ)");
    if (reason === null) return;
    setBusy(true);
    const r = await complianceDocumentSetStatus(id, status, reason);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="تغيير الحالة" />); return; }
    setNotice(`${r.data.note_ar} (منح نشطة متأثّرة: ${r.data.active_grants_now_blocked})`);
    await loadDocs(); await loadReady();
  }, [loadDocs, loadReady]);

  const view = useCallback(async (id: string) => {
    setBusy(true);
    const ref = await complianceDocumentStorageRef(id);
    setBusy(false);
    if (ref.state !== "ok") { setNotice(<OutcomeView state={ref.state} message={ref.message} what="فتح الملفّ" />); return; }
    const url = await complianceSign(ref.data.path, 120);
    if (!url) { setNotice("تعذّر تجهيز رابط مؤقّت. قد لا تملك صلاحية قراءة هذا الملفّ من التخزين."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const runScan = useCallback(async () => {
    setBusy(true);
    const r = await complianceScan(true);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="المسح الدوريّ" />); return; }
    setNotice(`أُدرجت ${r.data.documents_considered} حدثًا للوثائق. ${r.data.note_ar}`);
    await loadDocs(); await loadReady();
  }, [loadDocs, loadReady]);

  return (
    <>
      {notice && (
        <div style={{ marginBottom: "14px", fontSize: "12.5px", lineHeight: 2 }}>
          {typeof notice === "string" ? notice : notice}
        </div>
      )}

      {/* ─── الجاهزية ───────────────────────────────────────────────────── */}
      <Card title="جاهزية الامتثال" note="محرّك قواعد صريح — لا ذكاء اصطناعيّ. كلّ سطر يحمل سببه.">
        {ready.s === "load" && <EmptyState text="جارٍ الحساب…" />}
        {ready.s === "bad" && ready.view}
        {ready.s === "ok" && (
          <>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <Badge
                text={READINESS_STATE_AR[ready.d.state]}
                tone={ready.d.state === "ready" ? "good"
                  : ready.d.state === "ready_with_warnings" ? "warn"
                  : ready.d.state === "not_configured" ? "dim" : "bad"}
              />
              {/* ★ «لم تُعدّ القواعد» لا تُعرَض نسبةً ★ صفر هنا يُقرأ «غير ممتثلين». */}
              {ready.d.state !== "not_configured" && (
                <span style={{ color: CC.dim, fontSize: "11.5px" }}>
                  {ready.d.mandatory_met} من {ready.d.mandatory_total} متطلَّبًا إلزاميًّا · تحذيرات: {ready.d.warnings}
                </span>
              )}
              <Btn onClick={runScan} disabled={busy}>مسح وإدراج تنبيهات</Btn>
            </div>
            <p style={{ color: CC.dim, fontSize: "11.5px", lineHeight: 2, marginBottom: "10px" }}>
              {ready.d.note_ar} ⛔ إدراج تنبيه ليس إرسالًا: قنوات المركز كلّها تجريبية ولا شيء يُرسَل.
            </p>
            {ready.d.rows.length === 0 ? (
              <EmptyState text="لا قواعد فعّالة." why="هذه ليست «غير جاهز» — لم تُكتب المتطلّبات بعد." />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "6px" }}>
                {ready.d.rows.map((row) => (
                  <li
                    key={`${row.context}:${row.requirement_key}`}
                    style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "baseline", fontSize: "12px" }}
                  >
                    <Badge
                      text={VERDICT_AR[row.verdict]}
                      tone={row.verdict === "met" ? "good" : row.is_mandatory ? "bad" : "warn"}
                    />
                    <span>{row.label_ar || row.requirement_key}</span>
                    {!row.is_mandatory && <span style={{ color: CC.dim, fontSize: "10.5px" }}>(اختياريّ)</span>}
                    <span style={{ color: CC.dim, fontSize: "11px" }}>{row.reason_ar}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {/* ─── تسجيل وثيقة ────────────────────────────────────────────────── */}
      {access.can_manage_documents && (
        <Card
          title="تسجيل وثيقة أو إصدار جديد"
          note="⚠️ الرفع لا يجعل الوثيقة صالحة. التوثيق فعل منفصل يقوم به شخص آخر."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "0 14px" }}>
            <Field label="نوع الوثيقة (المفتاح)" value={form.doc_type}
              onChange={(v) => setForm({ ...form, doc_type: v })}
              placeholder="commercial_register" hint="مثل: gosi_certificate · zatca_compliance · hse_policy" />
            <Field label="العنوان" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            <Field label="الجهة المُصدِرة" value={form.issuer} onChange={(v) => setForm({ ...form, issuer: v })} />
            <Field label="الرقم المُقنَّع" value={form.doc_number_masked}
              onChange={(v) => setForm({ ...form, doc_number_masked: v })}
              placeholder="****1234"
              hint="⛔ لا تُدخل الرقم كاملًا — القاعدة ترفض أكثر من أربعة أرقام متتالية." />
            <Field label="تاريخ الإصدار" type="date" value={form.issued_on}
              onChange={(v) => setForm({ ...form, issued_on: v })} />
            <Field label="تاريخ الانتهاء" type="date" value={form.expires_on}
              onChange={(v) => setForm({ ...form, expires_on: v })} />
            <label style={{ display: "block", marginBottom: "10px" }}>
              <span style={{ display: "block", color: CC.dim, fontSize: "11px", marginBottom: "4px" }}>الحساسية</span>
              <select
                value={form.sensitivity}
                onChange={(e) => setForm({ ...form, sensitivity: e.target.value as Sensitivity })}
                style={{ width: "100%", border: `1px solid ${CC.line}`, background: "rgba(0,0,0,0.25)",
                  color: CC.text, borderRadius: "4px", padding: "8px 10px", fontSize: "12.5px" }}
              >
                {(Object.keys(SENSITIVITY_AR) as Sensitivity[]).map((s) => (
                  <option key={s} value={s} style={{ background: "#111" }}>{SENSITIVITY_AR[s]}</option>
                ))}
              </select>
              <span style={{ display: "block", color: CC.dim, fontSize: "10.5px", marginTop: "3px" }}>
                ⛔ خطاب المصرف والهوية والعقود ترفضها القاعدة إن اختير «عامّة».
              </span>
            </label>
            <label style={{ display: "block", marginBottom: "10px" }}>
              <span style={{ display: "block", color: CC.dim, fontSize: "11px", marginBottom: "4px" }}>الملفّ (PDF أو صورة)</span>
              <input type="file" accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: "11.5px", color: CC.dim }} />
            </label>
          </div>
          <Btn onClick={register} disabled={busy} tone="primary">تسجيل (بلا توثيق)</Btn>
        </Card>
      )}

      {/* ─── القائمة ────────────────────────────────────────────────────── */}
      <Card title="سجلّ الوثائق">
        {docs.s === "load" && <EmptyState text="جارٍ التحميل…" />}
        {docs.s === "bad" && docs.view}
        {docs.s === "ok" && (
          <>
            {docs.d.note_ar && (
              <p style={{ color: CC.amber, fontSize: "11.5px", lineHeight: 2, marginBottom: "10px" }}>
                {docs.d.note_ar}
              </p>
            )}
            {docs.d.scope === "operational_only" && (
              <p style={{ color: CC.dim, fontSize: "11.5px", marginBottom: "10px" }}>
                نطاقك التشغيليّ: وثائق السلامة والتصاريح فقط. الوثائق المالية والعقود خارج هذه الشاشة تمامًا.
              </p>
            )}
            {docs.d.rows.length === 0 ? (
              <EmptyState
                text="لا وثائق معروضة."
                why={docs.d.can_view_restricted
                  ? "لم تُسجَّل وثائق شركة بعد."
                  : "قد توجد وثائق مقيَّدة لا تملك صلاحية رؤيتها — هذا ليس دليلًا على عدم وجودها."}
              />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", minWidth: "760px" }}>
                  <thead>
                    <tr style={{ color: CC.dim, textAlign: "right" }}>
                      <th style={{ padding: "6px 8px" }}>الوثيقة</th>
                      <th style={{ padding: "6px 8px" }}>الحالة</th>
                      <th style={{ padding: "6px 8px" }}>الانتهاء</th>
                      <th style={{ padding: "6px 8px" }}>الحساسية</th>
                      <th style={{ padding: "6px 8px" }}>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.d.rows.map((d: ComplianceDocument) => {
                      const isUploader = !!myUserId && d.uploaded_by === myUserId;
                      const canDecide = access.can_verify_documents && !isUploader
                        && (d.status === "uploaded" || d.status === "pending_verification");
                      return (
                        <tr key={d.id} style={{ borderTop: `1px solid ${CC.line}` }}>
                          <td style={{ padding: "8px" }}>
                            <div>{d.title || d.label_ar || d.doc_type}</div>
                            <div style={{ color: CC.dim, fontSize: "10.5px" }}>
                              {d.doc_type} · إصدار {d.doc_version}
                              {d.doc_number_masked ? ` · ${d.doc_number_masked}` : ""}
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <Badge text={DOC_STATUS_AR[d.status]} tone={toneFor(d.status)} />
                            {DOC_STATUS_HINT_AR[d.status] && (
                              <div style={{ color: CC.dim, fontSize: "10.5px", marginTop: "4px", maxWidth: "230px" }}>
                                {DOC_STATUS_HINT_AR[d.status]}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {fmtDate(d.expires_on)}
                            {typeof d.days_left === "number" && d.days_left <= 30 && (
                              <div style={{ color: d.days_left < 0 ? CC.red : CC.amber, fontSize: "10.5px" }}>
                                {d.days_left < 0 ? `منتهية منذ ${-d.days_left} يومًا` : `يتبقّى ${d.days_left} يومًا`}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            <Badge text={SENSITIVITY_AR[d.sensitivity]}
                              tone={d.sensitivity === "restricted" ? "bad" : d.sensitivity === "confidential" ? "warn" : "dim"} />
                            {d.never_public && (
                              <div style={{ color: CC.dim, fontSize: "10.5px", marginTop: "4px" }}>لا تُنشر علنًا أبدًا</div>
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {d.has_file && <Btn onClick={() => view(d.id)} disabled={busy}>عرض</Btn>}
                              {canDecide && <Btn onClick={() => decide(d.id, "verified")} disabled={busy} tone="primary">توثيق</Btn>}
                              {canDecide && <Btn onClick={() => decide(d.id, "rejected")} disabled={busy}>رفض</Btn>}
                              {access.can_verify_documents && isUploader
                                && (d.status === "uploaded" || d.status === "pending_verification") && (
                                <span style={{ color: CC.dim, fontSize: "10.5px", alignSelf: "center" }}>
                                  رفعتَها بنفسك — التوثيق لغيرك.
                                </span>
                              )}
                              {access.can_manage_documents && d.status !== "archived" && d.status !== "revoked" && (
                                <Btn onClick={() => setStatus(d.id, "archived")} disabled={busy}>أرشفة</Btn>
                              )}
                              {access.can_verify_documents && d.status !== "revoked" && (
                                <Btn onClick={() => setStatus(d.id, "revoked")} disabled={busy} tone="danger">إلغاء</Btn>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
