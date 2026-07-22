"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClosureTab — Phase 5C. تبويب «إغلاق المشروع»: الجاهزية + الحواجز + دورة طلب الإغلاق +
// القبول النهائي + الدروس المستفادة + التقرير + الإغلاق النهائي (تأكيد + تجاوز) + إعادة الفتح + الأرشفة.
// بيانات حقيقية عبر project_closure_dashboard (نداء واحد). كل إجراء ⇒ RPC ذرّي. نص الحالة (لا لون فقط).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  projectClosureDashboard, projectClosureRequestCreate, projectClosureSubmit, projectClosureReview,
  projectFinalAcceptanceRequest, projectLessonUpsert, projectFinalClose, projectReopenRequestCreate,
  projectReopenApprove, projectArchiveCreate, closureErr, CLOSURE_STATUS, LESSON_CATEGORIES, REOPEN_STAGES,
  type ClosureDashboard, type ClosureBlocker,
} from "@/lib/portal/projectClosure";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const sevColor = (s?: string) => s === "critical" ? "#dc2626" : s === "major" ? "#d97706" : s === "minor" ? "#0891b2" : "#78716c";
const bl = (b: ClosureBlocker) => b.ar || b.en || b.code;

export default function ClosureTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<ClosureDashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reqSeq = useRef(0); const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([projectClosureDashboard(projectId), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("closure_timeout")), 20000); })]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[closure]", r.error); setErr(closureErr(r.error)); setPhase("error"); return; }
      setD(r.data); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "closure_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : closureErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  async function guard<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, okMsg: string) {
    if (busy) return; setBusy(true);
    const r = await fn(); setBusy(false);
    if (!r.ok) { flash(closureErr(r.error)); return; }
    flash(okMsg); await load();
  }

  async function createRequest() {
    const s = window.prompt(t({ ar: "ملخّص الإغلاق:", en: "Closure summary:" })); if (s === null) return;
    await guard(() => projectClosureRequestCreate(projectId, s), t({ ar: "أُنشئ طلب الإغلاق.", en: "Closure request created." }));
  }
  async function reviewAction(reqId: string, action: string, ver: number) {
    let comment: string | undefined;
    if (action !== "start_review") { const c = window.prompt(t({ ar: "ملاحظة/سبب:", en: "Note/reason:" })); if (c === null) return; comment = c; }
    await guard(() => projectClosureReview(reqId, action, comment, ver), t({ ar: "تم.", en: "Done." }));
  }
  async function requestClientAcceptance() {
    const uid = window.prompt(t({ ar: "معرّف مستخدم العميل (اختياري):", en: "Client user id (optional):" })); if (uid === null) return;
    await guard(() => projectFinalAcceptanceRequest(projectId, { acceptance_type: "client_final", requested_from: uid || undefined }), t({ ar: "طُلب قبول العميل.", en: "Acceptance requested." }));
  }
  async function addLesson() {
    const title = window.prompt(t({ ar: "عنوان الدرس المستفاد:", en: "Lesson title:" })); if (!title || !title.trim()) return;
    await guard(() => projectLessonUpsert(projectId, { title, category: "other" }), t({ ar: "أُضيف الدرس.", en: "Lesson added." }));
  }
  async function finalClose(reqId: string, ver: number, overrideable: ClosureBlocker[]) {
    const proj = window.prompt(t({ ar: `للتأكيد اكتب: إغلاق`, en: `Type "close" to confirm final close:` })); if (proj === null) return;
    if (!/^(إغلاق|close)$/i.test(proj.trim())) { flash(t({ ar: "لم يتطابق التأكيد.", en: "Confirmation mismatch." })); return; }
    let overridePayload: Record<string, unknown> = {};
    if (overrideable.length > 0) {
      const reason = window.prompt(t({ ar: `يوجد ${overrideable.length} حاجز قابل للتجاوز. سبب التجاوز (إلزامي):`, en: `${overrideable.length} overrideable blockers. Override reason (required):` }));
      if (reason === null) return;
      if (!reason.trim()) { flash(t({ ar: "سبب التجاوز إلزامي.", en: "Override reason required." })); return; }
      overridePayload = { reason };
    }
    const comment = window.prompt(t({ ar: "تعليق الإغلاق النهائي:", en: "Final closure comment:" })) ?? "";
    await guard(() => projectFinalClose(reqId, comment, ver, null, overridePayload), t({ ar: "أُغلق المشروع نهائيًّا.", en: "Project finally closed." }));
  }
  async function reopen() {
    const stage = window.prompt(t({ ar: `المرحلة المستهدفة (${REOPEN_STAGES.join("/")}):`, en: `Target stage (${REOPEN_STAGES.join("/")}):` })); if (!stage) return;
    if (!REOPEN_STAGES.includes(stage.trim())) { flash(t({ ar: "مرحلة غير مسموحة.", en: "Invalid stage." })); return; }
    const reason = window.prompt(t({ ar: "سبب إعادة الفتح (إلزامي):", en: "Reopen reason (required):" })); if (!reason || !reason.trim()) return;
    await guard(() => projectReopenRequestCreate(projectId, reason, stage.trim()), t({ ar: "طُلبت إعادة الفتح.", en: "Reopen requested." }));
  }
  async function approveReopen(id: string) {
    const c = window.prompt(t({ ar: "تعليق (اختياري):", en: "Comment (optional):" })); if (c === null) return;
    await guard(() => projectReopenApprove(id, c || undefined), t({ ar: "أُعيد فتح المشروع.", en: "Reopened." }));
  }
  async function archive() {
    if (!window.confirm(t({ ar: "أرشفة المشروع مؤسسيًّا؟", en: "Archive project?" }))) return;
    const reason = window.prompt(t({ ar: "سبب الأرشفة:", en: "Archive reason:" })) ?? "";
    await guard(() => projectArchiveCreate(projectId, { archive_reason: reason }), t({ ar: "أُرشف المشروع.", en: "Archived." }));
  }
  const openReport = () => window.open(`/client-portal/project-core/${projectId}/closure-report`, "_blank");

  if (phase === "loading") return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل الإغلاق…", en: "Loading closure…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-red-300">{t({ ar: "تعذّر تحميل الإغلاق.", en: "Couldn't load closure." })}</p>
      {err && <p className="text-[11px] text-stone-500">{err}</p>}
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!d) return null;
  const rd = d.readiness, req = d.active_request;
  const cs = CLOSURE_STATUS[d.closure_status] ?? CLOSURE_STATUS.closure_not_started;

  return (
    <div className="space-y-4" dir="rtl">
      {/* حالة الإغلاق + الجاهزية */}
      <section className={`${card} p-3 space-y-2`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs font-semibold text-stone-200">{t({ ar: "جاهزية الإغلاق", en: "Closure readiness" })}</h4>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: cs.color + "22", color: cs.color }}>{cs.ar}</span>
            {rd.readiness_percent != null && <span className="text-[11px] text-stone-300">{rd.readiness_percent}%</span>}
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: (rd.ready ? "#16a34a" : "#dc2626") + "22", color: rd.ready ? "#16a34a" : "#dc2626" }}>{rd.ready ? t({ ar: "جاهز", en: "Ready" }) : t({ ar: "غير جاهز", en: "Not ready" })}</span>
            <button onClick={() => void load()} className="text-xs text-stone-500 hover:text-white" aria-label="refresh">↻</button>
          </div>
        </div>
        <p className="text-[10px] text-stone-500">{rd.passed_checks.length}/{rd.required_checks.length} {t({ ar: "فحوص مطلوبة مجتازة", en: "required checks passed" })}</p>

        {rd.blockers.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-red-300">{t({ ar: "حواجز", en: "Blockers" })} ({rd.blockers.length})</p>
            {rd.blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] border-r-2 pr-2" style={{ borderColor: sevColor(b.severity) }}>
                <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: sevColor(b.severity) + "22", color: sevColor(b.severity) }}>{b.severity ?? "—"}</span>
                <span className="text-stone-300">{bl(b)}</span>
                {b.overrideable === false && <span className="text-[8px] text-red-400">{t({ ar: "غير قابل للتجاوز", en: "non-overrideable" })}</span>}
                {b.source && <span className="text-[9px] text-stone-600 ms-auto">{b.source}</span>}
              </div>
            ))}
          </div>
        )}
        {rd.advisory_warnings.length > 0 && (
          <div className="space-y-0.5 border-t border-stone-800 pt-1">
            {rd.advisory_warnings.map((w, i) => <p key={i} className="text-[10px] text-amber-400/80">⚠ {bl(w)}</p>)}
          </div>
        )}
        {rd.data_quality_warnings.length > 0 && rd.data_quality_warnings.map((w, i) => <p key={i} className="text-[10px] text-stone-500">· {bl(w)}</p>)}
        {rd.open_custody > 0 && <p className="text-[10px] text-amber-400/80">🔒 {rd.open_custody} {t({ ar: "عهدة مفتوحة — تُدار من نظام العهدة (لا تُغلق هنا)", en: "open custody — managed in custody system" })}</p>}
        {d.financial_visible && rd.financial && (
          <p className="text-[10px] text-stone-500">{t({ ar: "الإخلاء المالي", en: "Financial" })}: {rd.financial.available ? (rd.financial.payment_cleared ? t({ ar: "مسدَّد", en: "cleared" }) : t({ ar: "غير مؤكّد", en: "unconfirmed" })) : t({ ar: "غير متاح", en: "unavailable" })}</p>
        )}
      </section>

      {/* دورة طلب الإغلاق */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "طلب الإغلاق", en: "Closure request" })}</h4>
        {!req && d.closure_status !== "closed" && d.closure_status !== "archived" && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-stone-500">{t({ ar: "لا طلب إغلاق نشط.", en: "No active request." })}</p>
            {canManage && <button onClick={() => void createRequest()} disabled={busy} className="text-[11px] text-sky-300 border border-sky-800 rounded px-2 py-1">{t({ ar: "إنشاء طلب إغلاق", en: "Create request" })}</button>}
          </div>
        )}
        {req && (
          <div className={`${card} p-2.5 space-y-2 text-[11px]`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-stone-200">{req.request_no}</span>
              <span className="text-stone-500">{req.status}</span>
              {req.rejection_reason && <span className="text-amber-400/80">{req.rejection_reason}</span>}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {(req.status === "draft" || req.status === "changes_requested") && <button disabled={busy} onClick={() => void guard(() => projectClosureSubmit(req.id, req.version), t({ ar: "أُرسل للمراجعة.", en: "Submitted." }))} className="text-sky-400 hover:text-sky-300">{t({ ar: "إرسال للمراجعة", en: "Submit" })}</button>}
                {(req.status === "submitted") && <button disabled={busy} onClick={() => void reviewAction(req.id, "start_review", req.version)} className="text-cyan-400 hover:text-cyan-300">{t({ ar: "بدء المراجعة", en: "Start review" })}</button>}
                {(req.status === "submitted" || req.status === "under_review") && <>
                  <button disabled={busy} onClick={() => void reviewAction(req.id, "approve", req.version)} className="text-green-400 hover:text-green-300">{t({ ar: "اعتماد", en: "Approve" })}</button>
                  <button disabled={busy} onClick={() => void reviewAction(req.id, "request_changes", req.version)} className="text-amber-400 hover:text-amber-300">{t({ ar: "طلب تعديل", en: "Changes" })}</button>
                  <button disabled={busy} onClick={() => void reviewAction(req.id, "reject", req.version)} className="text-red-400 hover:text-red-300">{t({ ar: "رفض", en: "Reject" })}</button>
                </>}
                {req.status !== "closed" && <button disabled={busy} onClick={() => void reviewAction(req.id, "cancel", req.version)} className="text-stone-500 hover:text-stone-300">{t({ ar: "إلغاء الطلب", en: "Cancel" })}</button>}
                {req.status === "approved" && <button disabled={busy} onClick={() => void finalClose(req.id, req.version, rd.overrideable_blockers)} className="text-white bg-red-700 hover:bg-red-600 rounded px-3 py-1 font-medium">{t({ ar: "الإغلاق النهائي", en: "Final Close" })}</button>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* القبول النهائي + الدروس + التقرير */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <section className={`${card} p-2 space-y-1`}>
          <div className="flex items-center justify-between"><h5 className="text-[11px] font-semibold text-stone-300">{t({ ar: "القبول النهائي", en: "Acceptance" })} ({d.acceptances.length})</h5>
            {canManage && <button onClick={() => void requestClientAcceptance()} className="text-[10px] text-sky-400 hover:text-sky-300">+ {t({ ar: "طلب", en: "Request" })}</button>}</div>
          {d.acceptances.length === 0 && <p className="text-[10px] text-stone-600">{t({ ar: "لا طلبات.", en: "None." })}</p>}
          {d.acceptances.slice(0, 5).map((a) => <div key={a.id} className="text-[10px] border-b border-stone-900 py-0.5"><span className="text-stone-300">{a.acceptance_type}</span> · <span className="text-stone-500">{a.status}</span></div>)}
        </section>
        <section className={`${card} p-2 space-y-1`}>
          <div className="flex items-center justify-between"><h5 className="text-[11px] font-semibold text-stone-300">{t({ ar: "الدروس المستفادة", en: "Lessons" })} ({d.lessons_count})</h5>
            {canManage && <button onClick={() => void addLesson()} className="text-[10px] text-sky-400 hover:text-sky-300">+ {t({ ar: "إضافة", en: "Add" })}</button>}</div>
          <p className="text-[10px] text-stone-600">{d.lessons_count} {t({ ar: "درس مسجّل", en: "recorded" })}</p>
        </section>
        <section className={`${card} p-2 space-y-1`}>
          <h5 className="text-[11px] font-semibold text-stone-300">{t({ ar: "تقرير الإغلاق", en: "Closure report" })}</h5>
          <button onClick={openReport} className="text-[10px] text-sky-400 hover:text-sky-300">{t({ ar: "فتح التقرير (طباعة)", en: "Open report" })}</button>
        </section>
      </div>

      {/* إعادة الفتح + الأرشفة */}
      {(d.closure_status === "closed" || d.reopen_requests.length > 0 || d.archive) && (
        <section className="space-y-2 border-t border-stone-800 pt-2">
          <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "بعد الإغلاق", en: "Post-closure" })}</h4>
          <div className="flex flex-wrap gap-2">
            {d.closure_status === "closed" && canManage && <button disabled={busy} onClick={() => void reopen()} className="text-[11px] text-violet-300 border border-violet-800 rounded px-2 py-1">{t({ ar: "طلب إعادة فتح", en: "Request reopen" })}</button>}
            {d.closure_status === "closed" && !d.archive && canManage && <button disabled={busy} onClick={() => void archive()} className="text-[11px] text-stone-300 border border-stone-700 rounded px-2 py-1">{t({ ar: "أرشفة", en: "Archive" })}</button>}
          </div>
          {d.reopen_requests.filter((r) => r.status === "pending").map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className="text-violet-300">{t({ ar: "طلب إعادة فتح → ", en: "Reopen → " })}{r.requested_target_stage}</span>
              {canManage && <button disabled={busy} onClick={() => void approveReopen(r.id)} className="text-green-400 hover:text-green-300">{t({ ar: "اعتماد", en: "Approve" })}</button>}
            </div>
          ))}
          {d.archive && <p className="text-[10px] text-stone-500">{t({ ar: "الأرشيف", en: "Archive" })}: {d.archive.status}{d.archive.legal_hold ? " · " + t({ ar: "حجز قانوني", en: "legal hold" }) : ""}{d.archive.retention_until ? ` · ${t({ ar: "الاحتفاظ حتى", en: "retain until" })} ${d.archive.retention_until}` : ""}</p>}
        </section>
      )}
      <p className="text-[9px] text-stone-600">{t({ ar: "الإغلاق النهائي يغيّر المرحلة إلى «مغلق» عبر المسار الرسمي فقط. لا يُغلق العهدة أو يُعدّل المالية.", en: "Final close flips stage to closed via the official path only." })}</p>
    </div>
  );
}
