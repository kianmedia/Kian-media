"use client";
// ════════════════════════════════════════════════════════════════════════════
// طلبات التسجيل كمورّد — ★ صادر لا وارد ★
//
// كيان يطلب تسجيلنا مورّدًا لديه ⇒ نُعدّ الوثائق ونُسلّمها **يدويًّا**.
// هذا ليس سطح /opportunities (وارد: أفراد ومورّدون يتقدّمون إلينا)، ولذلك لم
// يُبنَ نموذج عامّ ثانٍ: مصدر الطلب قد يكون صفًّا هناك ويُشار إليه فقط.
//
// ★★ لا ادّعاء تقديم إلكترونيّ ★★ الانتقال إلى «سُلّم يدويًّا» يطلب مرجعًا
//    وقناة، والقاعدة ترفضه بقيد جدوليّ لو نقص أيّهما. لا يوجد في النظام كلّه
//    مسار يقدّم إلى بوّابة مشتريات.
//
// ★ قائمة التحقّق لا تُعلَّم يدويًّا لبنود الوثائق ★ استيفاؤها **مشتقّ** من
//   التعريف الواحد للصلاحية، فلا يمكن تعليم «تمّ» فوق وثيقة منتهية.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  REGISTRATION_STATUS_AR, SUBMISSION_TRUTH_AR, registrationComment, registrationGet,
  registrationList, registrationStatusBoard, registrationTransition, registrationUpsert,
  type RegistrationRow, type RegistrationStatus, type VccAccess,
} from "@/lib/portal/compliance";
import { Badge, Btn, CC, Card, EmptyState, Field, OutcomeView, fmtDate } from "./ComplianceAtoms";

const NEXT_STEPS: Record<RegistrationStatus, RegistrationStatus[]> = {
  received: ["under_review", "information_required", "closed", "expired"],
  under_review: ["information_required", "preparing_documents", "rejected", "closed", "expired"],
  information_required: ["under_review", "preparing_documents", "closed", "expired"],
  preparing_documents: ["pending_owner_approval", "information_required", "closed", "expired"],
  pending_owner_approval: ["ready_for_manual_submission", "preparing_documents", "closed", "expired"],
  ready_for_manual_submission: ["submitted_manually", "preparing_documents", "closed", "expired"],
  submitted_manually: ["accepted", "rejected", "expired", "closed"],
  accepted: ["closed"],
  rejected: ["closed"],
  expired: ["closed"],
  closed: [],
};

const tone = (s: RegistrationStatus): "good" | "warn" | "bad" | "dim" =>
  s === "accepted" ? "good"
    : s === "rejected" || s === "expired" ? "bad"
    : s === "pending_owner_approval" || s === "information_required" ? "warn"
    : "dim";

type Detail = Awaited<ReturnType<typeof registrationGet>> extends infer _ ? Record<string, unknown> : never;

export default function VendorRegistrationPanel({ access }: { access: VccAccess }) {
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [statusOnly, setStatusOnly] = useState<Array<Record<string, unknown>> | null>(null);
  const [err, setErr] = useState<JSX.Element | null>(null);
  const [notice, setNotice] = useState<JSX.Element | string>("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    organization_name: "", organization_sector: "", contact_name: "", contact_email: "",
    purpose: "", deadline: "", portal_name: "", portal_reference: "", required_doc_types: "",
  });

  const load = useCallback(async () => {
    if (access.can_manage_registration) {
      const r = await registrationList({});
      if (r.state === "ok") { setRows(r.data.rows); setErr(null); }
      else { setRows(null); setErr(<OutcomeView state={r.state} message={r.message} what="طلبات التسجيل" />); }
      return;
    }
    // ★ نافذة المبيعات ★ خمسة حقول، من دالّة مختلفة لا من ترشيح في المتصفّح.
    const b = await registrationStatusBoard();
    if (b.state === "ok") { setStatusOnly(b.data.rows as Array<Record<string, unknown>>); setErr(null); }
    else { setStatusOnly(null); setErr(<OutcomeView state={b.state} message={b.message} what="لوحة الحالة" />); }
  }, [access.can_manage_registration]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setBusy(true);
    const r = await registrationGet(id);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="تفاصيل الطلب" />); return; }
    setOpenId(id);
    setDetail(r.data as unknown as Record<string, unknown>);
  }, [openId]);

  const create = useCallback(async () => {
    setBusy(true); setNotice("");
    const r = await registrationUpsert({
      ...form,
      required_doc_types: form.required_doc_types.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="إنشاء طلب" />); return; }
    setNotice("أُنشئ الطلب وأُعدّت قائمة تحقّق أوّلية من الأنواع المطلوبة.");
    setForm({ ...form, organization_name: "", purpose: "", deadline: "", portal_reference: "", required_doc_types: "" });
    await load();
  }, [form, load]);

  const move = useCallback(async (id: string, to: RegistrationStatus) => {
    const input: Record<string, unknown> = {};
    if (to === "submitted_manually") {
      // ★★ الحقول الثلاثة إلزامية بقيد جدوليّ ★★ نطلبها هنا كي يفهم المستخدم
      //    لماذا، بدل أن يصطدم برسالة قاعدة بيانات.
      const ref = window.prompt("مرجع التسليم لدى الجهة (إلزاميّ — رقم إيصال أو مرجع بوّابة)");
      if (!ref) return;
      const ch = window.prompt("قناة التسليم: supplier_portal / email / courier / in_person / other");
      if (!ch) return;
      input.submission_reference = ref;
      input.submission_channel = ch;
    } else if (to === "information_required" || to === "rejected" || to === "closed" || to === "expired") {
      const note = window.prompt("السبب أو الملاحظة (إلزاميّ)");
      if (!note) return;
      input.note = note;
    } else if (to === "ready_for_manual_submission") {
      const note = window.prompt("ملاحظة اعتماد المالك (اختيارية)") ?? "";
      input.note = note;
    }
    setBusy(true);
    const r = await registrationTransition(id, to, input);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="تغيير الحالة" />); return; }
    setNotice(r.data.note_ar || `الحالة الآن: ${REGISTRATION_STATUS_AR[to]}`);
    await load();
    if (openId === id) { setOpenId(null); await openDetail(id); }
  }, [load, openId, openDetail]);

  const comment = useCallback(async (id: string) => {
    const body = window.prompt("تعليق داخليّ (لا يراه أيّ طرف خارجيّ)");
    if (!body) return;
    setBusy(true);
    const r = await registrationComment(id, body);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="التعليق" />); return; }
    setOpenId(null); await openDetail(id);
  }, [openDetail]);

  // ─── نافذة المبيعات: حالة فقط ─────────────────────────────────────────
  if (!access.can_manage_registration) {
    return (
      <Card title="حالة طلبات التسجيل"
        note="نطاقك: الحالة فقط. الوثائق والبيانات المصرفية والمرفقات والمراجع الداخلية خارج هذه الشاشة تمامًا.">
        {err}
        {!err && statusOnly === null && <EmptyState text="جارٍ التحميل…" />}
        {statusOnly !== null && statusOnly.length === 0 && <EmptyState text="لا طلبات مسجَّلة." />}
        {statusOnly !== null && statusOnly.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" }}>
            {statusOnly.map((r, i) => (
              <li key={i} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", fontSize: "12.5px" }}>
                <Badge text={REGISTRATION_STATUS_AR[String(r.status) as RegistrationStatus] ?? String(r.status)}
                  tone={tone(String(r.status) as RegistrationStatus)} />
                <span>{String(r.organization_name)}</span>
                <span style={{ color: CC.dim, fontSize: "11px" }}>{String(r.request_number ?? "")}</span>
                <span style={{ color: CC.dim, fontSize: "11px" }}>موعد: {fmtDate(r.deadline as string | null)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <>
      {notice && <div style={{ marginBottom: "14px", fontSize: "12.5px", lineHeight: 2 }}>{notice}</div>}

      <Card title="طلب تسجيل جديد" note={SUBMISSION_TRUTH_AR}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "0 14px" }}>
          <Field label="الجهة" value={form.organization_name} onChange={(v) => setForm({ ...form, organization_name: v })} />
          <Field label="القطاع" value={form.organization_sector} onChange={(v) => setForm({ ...form, organization_sector: v })} />
          <Field label="مسؤول التواصل" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} />
          <Field label="بريد التواصل" value={form.contact_email} onChange={(v) => setForm({ ...form, contact_email: v })} />
          <Field label="موعد التسليم" type="date" value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} />
          <Field label="بوّابة المشتريات" value={form.portal_name} onChange={(v) => setForm({ ...form, portal_name: v })} />
          <Field label="مرجع البوّابة" value={form.portal_reference}
            onChange={(v) => setForm({ ...form, portal_reference: v })}
            hint="مرجع لدى الطرف الآخر — ليس دليل تقديم." />
          <Field label="أنواع الوثائق المطلوبة" value={form.required_doc_types}
            onChange={(v) => setForm({ ...form, required_doc_types: v })}
            placeholder="commercial_register, zatca_compliance"
            hint="مفصولة بفواصل. تُبنى منها قائمة تحقّق استيفاؤها مشتقّ لا يدويّ." />
        </div>
        <Field label="الغرض (١٠ أحرف فأكثر)" value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} />
        <Btn onClick={create} disabled={busy} tone="primary">إنشاء</Btn>
      </Card>

      <Card title="الطلبات">
        {err}
        {!err && rows === null && <EmptyState text="جارٍ التحميل…" />}
        {rows !== null && rows.length === 0 && <EmptyState text="لا طلبات بعد." />}
        {rows !== null && rows.length > 0 && (
          <div style={{ display: "grid", gap: "10px" }}>
            {rows.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${CC.line}`, borderRadius: "5px", padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <Badge text={REGISTRATION_STATUS_AR[r.status]} tone={tone(r.status)} />
                  <strong style={{ fontSize: "12.5px" }}>{r.organization_name}</strong>
                  <span style={{ color: CC.dim, fontSize: "11px" }}>{r.request_number}</span>
                  {r.missing_count > 0 && <Badge text={`ناقص ${r.missing_count}`} tone="bad" />}
                </div>
                <div style={{ color: CC.dim, fontSize: "11.5px", lineHeight: 2, marginTop: "5px" }}>
                  موعد {fmtDate(r.deadline)}
                  {typeof r.days_to_deadline === "number" && r.days_to_deadline <= 14
                    && ` · يتبقّى ${r.days_to_deadline} يومًا`}
                  {r.portal_name ? ` · ${r.portal_name}` : ""}
                  {r.submitted_at ? ` · سُلّم ${fmtDate(r.submitted_at)}` : ""}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                  <Btn onClick={() => openDetail(r.id)} disabled={busy}>
                    {openId === r.id ? "إخفاء التفاصيل" : "التفاصيل"}
                  </Btn>
                  <Btn onClick={() => comment(r.id)} disabled={busy}>تعليق داخليّ</Btn>
                  {NEXT_STEPS[r.status].map((to) => (
                    <Btn key={to} onClick={() => move(r.id, to)} disabled={busy}
                      tone={to === "submitted_manually" ? "primary" : "plain"}>
                      {REGISTRATION_STATUS_AR[to]}
                    </Btn>
                  ))}
                </div>

                {openId === r.id && detail && (
                  <div style={{ marginTop: "12px", borderTop: `1px solid ${CC.line}`, paddingTop: "10px" }}>
                    <div style={{ color: CC.dim, fontSize: "11.5px", marginBottom: "8px" }}>
                      {String((detail as { note_ar?: string }).note_ar ?? "")}
                    </div>
                    <strong style={{ fontSize: "12px" }}>قائمة التحقّق</strong>
                    <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 12px", fontSize: "12px", lineHeight: 2 }}>
                      {((detail.checklist as Array<Record<string, unknown>>) ?? []).map((c) => (
                        <li key={String(c.id)} style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                          <Badge text={c.satisfied ? "مستوفًى" : "ناقص"} tone={c.satisfied ? "good" : "bad"} />
                          <span>{String(c.label)}</span>
                          {c.derived === true && (
                            <span style={{ color: CC.dim, fontSize: "10.5px" }}>
                              (مشتقّ من صلاحية الوثيقة — لا يُعلَّم يدويًّا)
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <strong style={{ fontSize: "12px" }}>تعليقات داخلية</strong>
                    <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", fontSize: "12px", lineHeight: 2, color: CC.dim }}>
                      {((detail.comments as Array<Record<string, unknown>>) ?? []).length === 0
                        ? <li>لا تعليقات.</li>
                        : ((detail.comments as Array<Record<string, unknown>>) ?? []).map((m) => (
                          <li key={String(m.id)}>{fmtDate(String(m.created_at))} — {String(m.body)}</li>
                        ))}
                    </ul>
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
