"use client";
// ════════════════════════════════════════════════════════════════════════════
// المنح الآمنة — أحدّ سطح في المركز.
//
// ★ التسلسل مقصود ومرئيّ للمستخدم ★
//   إنشاء (مسودّة) → إضافة وثائق → اعتماد المالك → إصدار الرمز → مشاركة يدوية
//   ولا يمكن اختصاره: الخادم يرفض الإصدار قبل الاعتماد، ويرفض الاعتماد بلا
//   وثائق، ويرفض إضافة وثيقة حسّاسة بلا طلب تسجيل مربوط وباعتماد.
//
// ★★ الرمز يظهر مرّة واحدة ★★ يُعرَض في هذه الشاشة بعد الإصدار مباشرةً ولا
//    يُخزَّن في أيّ مكان — لا localStorage ولا حالة مستمرّة. إن أُغلقت النافذة
//    قبل نسخه فلا سبيل لاستعادته: تُلغى المنحة وتُنشأ غيرها. نقول ذلك للمستخدم
//    **قبل** الضغط، لا بعده.
//
// ⛔ لا زرّ «إرسال». النظام لا يرسل هذا الرابط بأيّ قناة، والحالة «جاهز
//    للمشاركة اليدوية».
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  buildGrantShareLink, documentList, grantAddDocument, grantApprove, grantAudit,
  grantCreate, grantIssue, grantList, grantRevoke,
  GRANT_STATUS_AR, type ComplianceDocument, type DocumentGrant, type GrantStatus, type VccAccess,
} from "@/lib/portal/compliance";
import { Badge, Btn, CC, Card, EmptyState, Field, OutcomeView, fmtDate } from "./ComplianceAtoms";

const tone = (s: GrantStatus): "good" | "warn" | "bad" | "dim" =>
  s === "active" ? "good" : s === "revoked" || s === "expired" || s === "exhausted" ? "bad"
    : s === "approved" || s === "pending_approval" ? "warn" : "dim";

export default function SecureGrantsPanel({ access }: { access: VccAccess }) {
  const [rows, setRows] = useState<DocumentGrant[] | null>(null);
  const [docs, setDocs] = useState<ComplianceDocument[]>([]);
  const [err, setErr] = useState<JSX.Element | null>(null);
  const [notice, setNotice] = useState<JSX.Element | string>("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ id: string; token: string; link: string } | null>(null);
  const [auditFor, setAuditFor] = useState<{ id: string; rows: Array<Record<string, unknown>> } | null>(null);
  const [form, setForm] = useState({
    recipient_org: "", recipient_name: "", recipient_email: "", purpose: "",
    ttl_days: "7", max_opens: "10", max_downloads: "3", watermark_identity: "", request_id: "",
  });

  const load = useCallback(async () => {
    const r = await grantList({});
    if (r.state === "ok") { setRows(r.data.rows); setErr(null); }
    else { setRows(null); setErr(<OutcomeView state={r.state} message={r.message} what="سجلّ المنح" />); }
    const d = await documentList({});
    if (d.state === "ok") setDocs(d.data.rows.filter((x) => x.status === "verified"));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setBusy(true); setNotice("");
    const r = await grantCreate({
      ...form,
      request_id: form.request_id.trim() || null,
      ttl_days: form.ttl_days, max_opens: form.max_opens, max_downloads: form.max_downloads,
    });
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="إنشاء منحة" />); return; }
    setNotice(`أُنشئت المنحة ${r.data.grant_code}. ${r.data.note_ar}`);
    setForm({ ...form, recipient_org: "", recipient_name: "", recipient_email: "", purpose: "", watermark_identity: "" });
    await load();
  }, [form, load]);

  const addDoc = useCallback(async (grantId: string) => {
    if (docs.length === 0) { setNotice("لا توجد وثيقة موثَّقة وسارية لإضافتها. ⚠️ لا تُشارَك وثيقة غير موثَّقة."); return; }
    const list = docs.map((d, i) => `${i + 1}. ${d.title || d.label_ar || d.doc_type}`).join("\n");
    const pick = window.prompt(`اختر رقم الوثيقة:\n${list}`);
    if (pick === null) return;
    const idx = Number(pick) - 1;
    const chosen = docs[idx];
    if (!chosen) { setNotice("اختيار غير صالح."); return; }
    const allow = chosen.is_downloadable && window.confirm("السماح بالتنزيل؟ (إلغاء = عرض فقط)");
    setBusy(true);
    const r = await grantAddDocument(grantId, chosen.id, allow);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="إضافة وثيقة" />); return; }
    setNotice("أُضيفت الوثيقة إلى المنحة.");
    await load();
  }, [docs, load]);

  const approve = useCallback(async (id: string) => {
    const note = window.prompt("ملاحظة الاعتماد (اختيارية)") ?? undefined;
    setBusy(true);
    const r = await grantApprove(id, note);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="اعتماد المنحة" />); return; }
    setNotice(`اعتُمدت المنحة (${r.data.documents} وثيقة). أصدِر الرمز الآن.`);
    await load();
  }, [load]);

  const issue = useCallback(async (id: string) => {
    const ok = window.confirm(
      "سيظهر الرمز مرّة واحدة فقط ولن يُخزَّن. إن أغلقت الصفحة قبل نسخه فلا يمكن استرجاعه — "
      + "سيلزم إلغاء المنحة وإنشاء غيرها.\n\nمتابعة؟",
    );
    if (!ok) return;
    setBusy(true);
    const r = await grantIssue(id);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="إصدار الرمز" />); return; }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setIssued({ id, token: r.data.token, link: buildGrantShareLink(origin, r.data.token) });
    setNotice(r.data.note_ar);
    await load();
  }, [load]);

  const revoke = useCallback(async (id: string) => {
    const reason = window.prompt("سبب الإلغاء (إلزاميّ)");
    if (reason === null) return;
    setBusy(true);
    const r = await grantRevoke(id, reason);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="إلغاء المنحة" />); return; }
    setNotice(r.data.note_ar);
    if (issued?.id === id) setIssued(null);
    await load();
  }, [issued, load]);

  const showAudit = useCallback(async (id: string) => {
    setBusy(true);
    const r = await grantAudit(id);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="سجلّ الوصول" />); return; }
    setAuditFor({ id, rows: r.data.rows });
  }, []);

  if (!access.can_issue_grants) {
    return <Card title="المنح الآمنة"><OutcomeView state="denied" message="إصدار المنح يتطلّب مفتاحًا مستقلًّا عن رؤية المركز." /></Card>;
  }

  return (
    <>
      {notice && <div style={{ marginBottom: "14px", fontSize: "12.5px", lineHeight: 2 }}>{notice}</div>}

      {issued && (
        <Card title="★ الرمز — يظهر مرّة واحدة ★"
          note="انسخه الآن. لا يُخزَّن في أيّ مكان، ولن تراه ثانيةً. ⛔ النظام لا يرسله: سلّمه بنفسك.">
          <textarea
            readOnly
            value={issued.link}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%", minHeight: "70px", border: `1px solid ${CC.accent}`,
              background: "rgba(0,0,0,0.3)", color: CC.text, borderRadius: "4px",
              padding: "10px", fontSize: "12px", direction: "ltr", fontFamily: "monospace",
            }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
            <Btn onClick={() => { void navigator.clipboard?.writeText(issued.link); setNotice("نُسخ الرابط."); }}>
              نسخ الرابط
            </Btn>
            <Btn onClick={() => setIssued(null)} tone="danger">أخفِ الرمز نهائيًّا</Btn>
          </div>
          <p style={{ color: CC.dim, fontSize: "11px", lineHeight: 2, marginTop: "10px" }}>
            الرمز في الجزء بعد # عمدًا: هذا الجزء لا يُرسَل إلى أيّ خادم ولا يظهر في سجلّات
            الوصول ولا في ترويسة المُحيل، بخلاف ما لو وُضع في نصّ الرابط.
          </p>
        </Card>
      )}

      <Card title="إنشاء منحة"
        note="⚠️ الوثيقة الحسّاسة (خطاب مصرف · هوية · عقد) لا تدخل منحة إلّا مربوطة بطلب تسجيل معلوم وباعتماد المالك.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "0 14px" }}>
          <Field label="الجهة المتلقّية" value={form.recipient_org} onChange={(v) => setForm({ ...form, recipient_org: v })} />
          <Field label="اسم المسؤول" value={form.recipient_name} onChange={(v) => setForm({ ...form, recipient_name: v })} />
          <Field label="البريد (بيانات وصفية فقط)" value={form.recipient_email}
            onChange={(v) => setForm({ ...form, recipient_email: v })}
            hint="⛔ لا يُرسَل إليه شيء من النظام — يُسجَّل للتوثيق فقط." />
          <Field label="هوية العلامة المائية" value={form.watermark_identity}
            onChange={(v) => setForm({ ...form, watermark_identity: v })}
            hint="تُطبع على كلّ عرض. تُشتقّ من الجهة والاسم إن تُركت فارغة." />
          <Field label="مدّة الصلاحية (أيام)" type="number" value={form.ttl_days} onChange={(v) => setForm({ ...form, ttl_days: v })} />
          <Field label="حدّ الفتح" type="number" value={form.max_opens} onChange={(v) => setForm({ ...form, max_opens: v })} />
          <Field label="حدّ التنزيل" type="number" value={form.max_downloads}
            onChange={(v) => setForm({ ...form, max_downloads: v })} hint="صفر = عرض فقط." />
          <Field label="معرّف طلب التسجيل (اختياريّ)" value={form.request_id}
            onChange={(v) => setForm({ ...form, request_id: v })} hint="إلزاميّ للوثائق الحسّاسة." />
        </div>
        <label style={{ display: "block", marginBottom: "10px" }}>
          <span style={{ display: "block", color: CC.dim, fontSize: "11px", marginBottom: "4px" }}>
            الغرض (٢٠ حرفًا فأكثر — يُعرَض للمتلقّي)
          </span>
          <textarea
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            style={{ width: "100%", minHeight: "60px", border: `1px solid ${CC.line}`,
              background: "rgba(0,0,0,0.25)", color: CC.text, borderRadius: "4px", padding: "8px 10px", fontSize: "12.5px" }}
          />
        </label>
        <Btn onClick={create} disabled={busy} tone="primary">إنشاء مسودّة</Btn>
      </Card>

      <Card title="المنح">
        {err}
        {!err && rows === null && <EmptyState text="جارٍ التحميل…" />}
        {rows !== null && rows.length === 0 && (
          <EmptyState text="لا منح بعد." why="أنشئ مسودّة أعلاه، أضف وثائق موثَّقة، ثمّ اطلب اعتماد المالك." />
        )}
        {rows !== null && rows.length > 0 && (
          <div style={{ display: "grid", gap: "10px" }}>
            {rows.map((g) => (
              <div key={g.id} style={{ border: `1px solid ${CC.line}`, borderRadius: "5px", padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <Badge text={GRANT_STATUS_AR[g.status]} tone={tone(g.status)} />
                  <strong style={{ fontSize: "12.5px" }}>{g.recipient_org}</strong>
                  <span style={{ color: CC.dim, fontSize: "11.5px" }}>{g.recipient_name}</span>
                  <span style={{ color: CC.dim, fontSize: "11px" }}>{g.grant_code}</span>
                </div>
                <div style={{ color: CC.dim, fontSize: "11.5px", lineHeight: 2, marginTop: "6px" }}>
                  ينتهي {fmtDate(g.expires_at)} · وثائق {g.documents} ·
                  فتح {g.opens_used}/{g.max_opens} · تنزيل {g.downloads_used}/{g.max_downloads}
                  {g.token_hint ? ` · رمز …${g.token_hint}` : " · لم يُصدر رمز"}
                </div>
                {g.revoke_reason && (
                  <div style={{ color: CC.red, fontSize: "11.5px", marginTop: "4px" }}>سبب الإلغاء: {g.revoke_reason}</div>
                )}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                  {(g.status === "draft" || g.status === "pending_approval") && (
                    <Btn onClick={() => addDoc(g.id)} disabled={busy}>إضافة وثيقة</Btn>
                  )}
                  {(g.status === "draft" || g.status === "pending_approval") && access.is_owner && (
                    <Btn onClick={() => approve(g.id)} disabled={busy}>اعتماد (المالك)</Btn>
                  )}
                  {(g.status === "draft" || g.status === "pending_approval") && !access.is_owner && (
                    <span style={{ color: CC.dim, fontSize: "10.5px", alignSelf: "center" }}>
                      الاعتماد للمالك — من يُعدّ الرابط ليس من يأذن به.
                    </span>
                  )}
                  {g.status === "approved" && <Btn onClick={() => issue(g.id)} disabled={busy} tone="primary">إصدار الرمز</Btn>}
                  {g.status !== "revoked" && <Btn onClick={() => revoke(g.id)} disabled={busy} tone="danger">إلغاء</Btn>}
                  <Btn onClick={() => showAudit(g.id)} disabled={busy}>سجلّ الوصول</Btn>
                </div>
                {auditFor?.id === g.id && (
                  <div style={{ marginTop: "10px", borderTop: `1px solid ${CC.line}`, paddingTop: "8px" }}>
                    {auditFor.rows.length === 0 ? (
                      <EmptyState text="لم يُفتح هذا الرابط بعد." why="السجلّ يشمل المحاولات المرفوضة أيضًا." />
                    ) : (
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "11.5px", lineHeight: 2 }}>
                        {auditFor.rows.slice(0, 25).map((a, i) => (
                          <li key={i} style={{ color: a.action === "denied" ? CC.red : CC.dim }}>
                            {fmtDate(String(a.at))} · {String(a.action)}
                            {a.denied_reason ? ` · ${String(a.denied_reason)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
